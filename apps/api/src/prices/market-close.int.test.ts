import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assetLimitDays,
  assets,
  leagues,
  memberships,
  outboxEvents,
  players,
  tenants,
  virtualOrders,
} from '../db/schema';
import { connectIntegration, createTenant, deleteTenants } from '../test/integration.test-utils';
import { DrizzleAssetCloseRepository } from './drizzle-asset-close.repository';
import { DrizzlePriceFeedDirectory } from './drizzle-feed.directory';

/** Kapanış fiyatı yazımı ve fiyat akışı kaynak listesi, gerçek PostgreSQL ile (Faz 2, 7. adım). */
const ctx = connectIntegration();
const tenantIds: string[] = [];
let tenantId: string;

beforeAll(async () => {
  tenantId = await createTenant(ctx.db, 'market-close');
  tenantIds.push(tenantId);
  await ctx.db
    .update(tenants)
    .set({ priceFeedUrl: 'http://feed.test/prices' })
    .where(eq(tenants.id, tenantId));
  await ctx.db.insert(assets).values([
    { tenantId, symbol: 'THYAO', name: 'Türk Hava Yolları', assetClass: 'equity', sector: 'Ulaştırma' },
    { tenantId, symbol: 'GARAN', name: 'Garanti', assetClass: 'equity', sector: 'Bankacılık' },
    { tenantId, symbol: 'BTC', name: 'Bitcoin', assetClass: 'crypto' },
  ]);
});

afterAll(async () => {
  await deleteTenants(ctx.db, tenantIds);
  await ctx.close();
});

const read = async (symbol: string) => {
  const [row] = await ctx.db
    .select({
      referenceClose: assets.referenceClose,
      referenceCloseDate: assets.referenceCloseDate,
      sector: assets.sector,
    })
    .from(assets)
    .where(and(eq(assets.tenantId, tenantId), eq(assets.symbol, symbol)));
  return row;
};

describe('DrizzleAssetCloseRepository', () => {
  const repository = new DrizzleAssetCloseRepository(ctx.db);

  it('hisse varlığına kapanışı ve tarihini yazar', async () => {
    const saved = await repository.saveCloses(tenantId, '2026-09-22', [
      { symbol: 'THYAO', close: '317.6200000000' },
    ]);
    expect(saved).toBe(1);
    expect(await read('THYAO')).toMatchObject({
      referenceClose: '317.6200000000',
      referenceCloseDate: '2026-09-22',
    });
  });

  it('aynı ya da daha eski tarihi ikinci kez yazmaz', async () => {
    expect(await repository.saveCloses(tenantId, '2026-09-22', [{ symbol: 'THYAO', close: '1' }])).toBe(0);
    expect(await repository.saveCloses(tenantId, '2026-09-21', [{ symbol: 'THYAO', close: '2' }])).toBe(0);
    expect((await read('THYAO'))?.referenceClose).toBe('317.6200000000');
  });

  it('daha yeni tarihi yazar', async () => {
    expect(await repository.saveCloses(tenantId, '2026-09-23', [{ symbol: 'THYAO', close: '320' }])).toBe(1);
    expect((await read('THYAO'))?.referenceCloseDate).toBe('2026-09-23');
  });

  it('kripto varlığa kapanış yazılmaz', async () => {
    expect(await repository.saveCloses(tenantId, '2026-09-23', [{ symbol: 'BTC', close: '4000000' }])).toBe(
      0,
    );
    expect(await read('BTC')).toMatchObject({ referenceClose: null, referenceCloseDate: null });
  });

  it('başka platformun sembolüne yazmaz', async () => {
    const other = await createTenant(ctx.db, 'market-close-other');
    tenantIds.push(other);
    await ctx.db
      .insert(assets)
      .values({ tenantId: other, symbol: 'THYAO', name: 'THY', assetClass: 'equity' });
    expect(await repository.saveCloses(other, '2026-09-24', [{ symbol: 'GARAN', close: '9' }])).toBe(0);
    expect((await read('GARAN'))?.referenceClose).toBeNull();
  });
});

describe('DrizzlePriceFeedDirectory', () => {
  it('hisse varlıklarını referans kapanışıyla birlikte verir', async () => {
    const sources = await new DrizzlePriceFeedDirectory(ctx.db).listSources();
    const source = sources.find((s) => s.tenantId === tenantId);
    expect(source).toBeDefined();
    expect(source?.symbols.has('BTC')).toBe(true);
    // Kripto varlık hisse listesine girmez: seans ve limit kuralları ona uygulanmaz.
    expect(source?.equities.has('BTC')).toBe(false);
    expect(source?.equities.get('THYAO')).toEqual({
      symbol: 'THYAO',
      referenceClose: '320.0000000000',
      referenceCloseDate: '2026-09-23',
    });
    expect(source?.equities.get('GARAN')).toEqual({
      symbol: 'GARAN',
      referenceClose: null,
      referenceCloseDate: null,
    });
  });
});

describe('DrizzleAssetCloseRepository, tavan/taban günleri (K-030)', () => {
  const repository = new DrizzleAssetCloseRepository(ctx.db);
  let limitTenant: string;
  let assetOf: Record<string, string>;

  beforeAll(async () => {
    limitTenant = await createTenant(ctx.db, 'limit-days');
    tenantIds.push(limitTenant);
    const rows = await ctx.db
      .insert(assets)
      .values(
        ['UP', 'DOWN', 'FLAT', 'NOREF'].map((symbol) => ({
          tenantId: limitTenant,
          symbol,
          name: symbol,
          assetClass: 'equity' as const,
          // NOREF ilk kapanışta: önceki kapanış olmadığı için limit de yok.
          ...(symbol === 'NOREF' ? {} : { referenceClose: '100', referenceCloseDate: '2026-09-21' }),
        })),
      )
      .returning({ id: assets.id, symbol: assets.symbol });
    assetOf = Object.fromEntries(rows.map((r) => [r.symbol, r.id]));
  });

  const limitDays = async () =>
    (await ctx.db.select().from(assetLimitDays).where(eq(assetLimitDays.tenantId, limitTenant)))
      .map(
        (r) =>
          `${r.assetId === assetOf.UP ? 'UP' : r.assetId === assetOf.DOWN ? 'DOWN' : '?'}:${r.sessionDate}:${r.kind}`,
      )
      .sort();

  it('önceki kapanışa göre tavanda ve tabanda kapananı yazar, aralıktakini ve referanssızı yazmaz', async () => {
    const saved = await repository.saveCloses(limitTenant, '2026-09-22', [
      { symbol: 'UP', close: '110.0000' },
      { symbol: 'DOWN', close: '90.0000' },
      { symbol: 'FLAT', close: '103' },
      { symbol: 'NOREF', close: '500' },
    ]);
    expect(saved).toBe(4);
    expect(await limitDays()).toEqual(['DOWN:2026-09-22:limit_down', 'UP:2026-09-22:limit_up']);
  });

  it('aynı gün ikinci kez yazılınca ne kapanış ne tavan günü tekrarlanır', async () => {
    expect(
      await repository.saveCloses(limitTenant, '2026-09-22', [{ symbol: 'UP', close: '110.0000' }]),
    ).toBe(0);
    expect(await limitDays()).toHaveLength(2);
  });

  it('kapanış tarihi ilerlediği için ertesi gün yeni referansa göre değerlendirilir', async () => {
    // UP dün 110'da kapandı: bugünün tavanı 121. 110'da kalması tavan değildir.
    expect(
      await repository.saveCloses(limitTenant, '2026-09-23', [{ symbol: 'UP', close: '110.0000' }]),
    ).toBe(1);
    expect(await limitDays()).toEqual(['DOWN:2026-09-22:limit_down', 'UP:2026-09-22:limit_up']);
  });

  it('eşzamanlı yazımda tavan günü bir kez yazılır', async () => {
    const [asset] = await ctx.db
      .insert(assets)
      .values({
        tenantId: limitTenant,
        symbol: 'RACE',
        name: 'RACE',
        assetClass: 'equity',
        referenceClose: '100',
        referenceCloseDate: '2026-09-21',
      })
      .returning({ id: assets.id });
    // Havuzdaki bağlantılar önceden açılır: yoksa işlemler bağlantı beklerken sırayla çalışır, yarış oluşmaz.
    await Promise.all(Array.from({ length: 8 }, () => ctx.db.execute(sql`select pg_sleep(0.05)`)));
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.saveCloses(limitTenant, '2026-09-22', [{ symbol: 'RACE', close: '110.0000' }]),
      ),
    );
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    const rows = await ctx.db.select().from(assetLimitDays).where(eq(assetLimitDays.assetId, asset!.id));
    expect(rows).toHaveLength(1);
  });

  it('tavan hissesinden o gün alış yapan oyuncular için rozet sinyali yazar, diğerleri için yazmaz', async () => {
    const [asset] = await ctx.db
      .insert(assets)
      .values({
        tenantId: limitTenant,
        symbol: 'SIGNAL',
        name: 'SIGNAL',
        assetClass: 'equity',
        referenceClose: '100',
        referenceCloseDate: '2026-09-21',
      })
      .returning({ id: assets.id });
    const [league] = await ctx.db
      .insert(leagues)
      .values({
        tenantId: limitTenant,
        name: 'signal',
        type: 'weekly',
        status: 'active',
        startsAt: new Date('2026-09-01T00:00:00Z'),
        endsAt: new Date('2026-10-30T00:00:00Z'),
        startingCash: '1000.00',
        assetIds: [asset!.id],
      })
      .returning({ id: leagues.id });

    const member = async (label: string, side: 'buy' | 'sell', at: string) => {
      const [player] = await ctx.db
        .insert(players)
        .values({
          tenantId: limitTenant,
          externalId: `${label}-${Date.now()}-${Math.random()}`,
          displayName: label,
        })
        .returning({ id: players.id });
      const [m] = await ctx.db
        .insert(memberships)
        .values({ leagueId: league!.id, playerId: player!.id, cash: '1000.00' })
        .returning({ id: memberships.id });
      await ctx.db.insert(virtualOrders).values({
        membershipId: m!.id,
        assetId: asset!.id,
        side,
        amount: '10.00',
        price: '10',
        quantity: '1',
        idempotencyKey: crypto.randomUUID(),
        requestHash: 't',
        createdAt: new Date(at),
      });
      return player!.id;
    };
    const buyer = await member('buyer', 'buy', '2026-09-22T08:00:00+03:00');
    const seller = await member('seller', 'sell', '2026-09-22T08:00:00+03:00');
    const nextDay = await member('nextday', 'buy', '2026-09-23T08:00:00+03:00');

    await repository.saveCloses(limitTenant, '2026-09-22', [{ symbol: 'SIGNAL', close: '110.0000' }]);

    const signalled = async (playerId: string) =>
      (
        await ctx.db
          .select({ type: outboxEvents.type })
          .from(outboxEvents)
          .where(eq(outboxEvents.playerId, playerId))
      ).map((r) => r.type);
    expect(await signalled(buyer)).toEqual(['badge_recheck']);
    expect(await signalled(seller)).toEqual([]);
    expect(await signalled(nextDay)).toEqual([]);
  });
});
