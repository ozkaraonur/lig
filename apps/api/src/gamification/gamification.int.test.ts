import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env';
import {
  assetLimitDays,
  assets,
  leagues,
  memberships,
  outboxEvents,
  playerBadges,
  players,
  questProgress,
  quests,
  virtualOrders,
} from '../db/schema';
import { DrizzleLeagueCloseUnitOfWork } from '../ranking/drizzle-ranking';
import { OutboxWorker } from '../quests/outbox.worker';
import {
  connectIntegration,
  createTenant,
  deleteTenants,
  type IntegrationContext,
} from '../test/integration.test-utils';
import { awardBadges } from './badge-store';
import { DrizzleAppearanceReader, DrizzleProfileRepository } from './drizzle-profile';
import { ProfileService } from './profile.service';

/** Rozetler, seçim ve görünüm okuma, gerçek PostgreSQL ile (Faz 3, 2. adım, K-030). */
let ctx: IntegrationContext;
let tenantId: string;
let otherTenantId: string;
let leagueId: string;
let finishedLeagueId: string;
const asset = { bank: '', energy: '', defense: '', crypto: '', foreign: '' };

const NOW = new Date('2026-09-23T09:00:00Z');
/** Test seans günü: 22 Eylül 2026 salı, Türkiye saatiyle. */
const LIMIT_DAY = '2026-09-22';
const env = parseEnv({ DATABASE_URL: 'postgres://x@localhost/x', REDIS_URL: 'redis://localhost' });

async function newPlayer(leagueForMembership = leagueId, forTenant = tenantId) {
  const [player] = await ctx.db
    .insert(players)
    .values({ tenantId: forTenant, externalId: `g-${randomUUID()}`, displayName: 'Rozetçi' })
    .returning({ id: players.id });
  const [member] = await ctx.db
    .insert(memberships)
    .values({ leagueId: leagueForMembership, playerId: player!.id, cash: '1000.00' })
    .returning({ id: memberships.id });
  return { playerId: player!.id, membershipId: member!.id };
}

async function order(
  membershipId: string,
  assetId: string,
  side: 'buy' | 'sell' = 'buy',
  createdAt: Date = NOW,
): Promise<void> {
  await ctx.db.insert(virtualOrders).values({
    membershipId,
    assetId,
    side,
    amount: '10.00',
    price: '10',
    quantity: '1',
    idempotencyKey: randomUUID(),
    requestHash: 'test',
    createdAt,
  });
}

const badgesOf = async (playerId: string) =>
  (
    await ctx.db
      .select({ id: playerBadges.badgeId })
      .from(playerBadges)
      .where(eq(playerBadges.playerId, playerId))
  )
    .map((r) => r.id)
    .sort();

const award = (playerId: string, forTenant = tenantId) => awardBadges(ctx.db, forTenant, playerId, NOW);

beforeAll(async () => {
  ctx = connectIntegration();
  tenantId = await createTenant(ctx.db, 'gami');
  otherTenantId = await createTenant(ctx.db, 'gami-other');
  const rows = await ctx.db
    .insert(assets)
    .values([
      { tenantId, symbol: 'BNK', name: 'Banka', assetClass: 'equity', sector: 'Bankacılık' },
      { tenantId, symbol: 'ENRJ', name: 'Enerji', assetClass: 'equity', sector: 'Enerji' },
      { tenantId, symbol: 'SVNM', name: 'Savunma', assetClass: 'equity', sector: 'Savunma' },
      { tenantId, symbol: 'KRPT', name: 'Kripto', assetClass: 'crypto' },
      { tenantId: otherTenantId, symbol: 'YBNC', name: 'Yabancı', assetClass: 'equity', sector: 'Turizm' },
    ])
    .returning({ id: assets.id, symbol: assets.symbol });
  const bySymbol = new Map(rows.map((r) => [r.symbol, r.id]));
  asset.bank = bySymbol.get('BNK')!;
  asset.energy = bySymbol.get('ENRJ')!;
  asset.defense = bySymbol.get('SVNM')!;
  asset.crypto = bySymbol.get('KRPT')!;
  asset.foreign = bySymbol.get('YBNC')!;

  const base = {
    tenantId,
    type: 'weekly' as const,
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2026-10-30T00:00:00Z'),
    startingCash: '1000.00',
    assetIds: [asset.bank, asset.energy, asset.defense, asset.crypto],
  };
  const [active] = await ctx.db
    .insert(leagues)
    .values({ ...base, name: 'gami-active', status: 'active' })
    .returning({ id: leagues.id });
  const [finished] = await ctx.db
    .insert(leagues)
    .values({ ...base, name: 'gami-finished', status: 'finished', closedAt: NOW })
    .returning({ id: leagues.id });
  leagueId = active!.id;
  finishedLeagueId = finished!.id;

  await ctx.db.insert(assetLimitDays).values([
    { assetId: asset.bank, tenantId, sessionDate: LIMIT_DAY, kind: 'limit_up' },
    { assetId: asset.energy, tenantId, sessionDate: LIMIT_DAY, kind: 'limit_down' },
  ]);
});

afterAll(async () => {
  await deleteTenants(ctx.db, [tenantId, otherTenantId]);
  await ctx.close();
});

describe('İlk Emir, Çeşitli Portföy', () => {
  it('emri olmayan oyuncu rozet almaz, ilk emirle İlk Emir kazanır', async () => {
    const p = await newPlayer();
    expect(await award(p.playerId)).toEqual([]);
    await order(p.membershipId, asset.bank);
    expect(await award(p.playerId)).toEqual(['first_order']);
    expect(await badgesOf(p.playerId)).toEqual(['first_order']);
  });

  it('aynı ligde 3 farklı varlıktan alış Çeşitli Portföy verir, 2 varlık vermez', async () => {
    const two = await newPlayer();
    await order(two.membershipId, asset.bank);
    await order(two.membershipId, asset.energy);
    await order(two.membershipId, asset.bank);
    expect(await award(two.playerId)).toEqual(['first_order']);

    const three = await newPlayer();
    await order(three.membershipId, asset.bank);
    await order(three.membershipId, asset.energy);
    await order(three.membershipId, asset.crypto); // sektörü olmayan varlık da sayılır: kripto platformunda da kazanılır
    expect((await award(three.playerId)).sort()).toEqual(['diverse_portfolio', 'first_order']);
  });

  it('satışlar farklı varlık sayısına girmez', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank);
    await order(p.membershipId, asset.energy, 'sell');
    await order(p.membershipId, asset.defense, 'sell');
    expect(await award(p.playerId)).toEqual(['first_order']);
  });

  it('üç varlık farklı liglere dağılmışsa Çeşitli Portföy verilmez', async () => {
    const p = await newPlayer();
    const [second] = await ctx.db
      .insert(memberships)
      .values({ leagueId: finishedLeagueId, playerId: p.playerId, cash: '1000.00' })
      .returning({ id: memberships.id });
    await order(p.membershipId, asset.bank);
    await order(p.membershipId, asset.energy);
    await order(second!.id, asset.defense);
    expect(await award(p.playerId)).toEqual(['first_order']);
  });
});

describe('Görev Avcısı', () => {
  it('5 tamamlanmış görevde kazanılır, 4 görevde kazanılmaz; başka platformun görevi sayılmaz', async () => {
    const templates = [
      'join_league',
      'place_orders',
      'trade_distinct_assets',
      'buy_distinct_sectors',
      'real_trade',
    ] as const;
    const own = await ctx.db
      .insert(quests)
      .values(
        templates.map((template) => ({ tenantId, template, period: 'once', targetCount: 1, xpReward: 10 })),
      )
      .returning({ id: quests.id });
    const foreign = await ctx.db
      .insert(quests)
      .values({
        tenantId: otherTenantId,
        template: 'place_orders',
        period: 'once',
        targetCount: 1,
        xpReward: 10,
      })
      .returning({ id: quests.id });

    const p = await newPlayer();
    const complete = (questId: string) =>
      ctx.db
        .insert(questProgress)
        .values({ playerId: p.playerId, questId, periodKey: 'once', completedAt: NOW });

    for (const q of own.slice(0, 4)) await complete(q.id);
    await complete(foreign[0]!.id);
    expect(await award(p.playerId)).toEqual([]);

    await complete(own[4]!.id);
    expect(await award(p.playerId)).toEqual(['quest_hunter']);
  });

  it('tamamlanmamış görev sayılmaz', async () => {
    const p = await newPlayer();
    const rows = await ctx.db.select({ id: quests.id }).from(quests).where(eq(quests.tenantId, tenantId));
    for (const q of rows) {
      await ctx.db.insert(questProgress).values({ playerId: p.playerId, questId: q.id, periodKey: 'once' });
    }
    expect(await award(p.playerId)).toEqual([]);
  });
});

describe('Lig Bitirici, Podyum', () => {
  const finishWith = async (rank: number | null, withOrder: boolean, league = finishedLeagueId) => {
    const p = await newPlayer(league);
    await ctx.db
      .update(memberships)
      .set({ finalRank: rank, finalValue: rank === null ? null : '1000.00' })
      .where(eq(memberships.id, p.membershipId));
    if (withOrder) await order(p.membershipId, asset.bank);
    return p;
  };

  it('bitmiş ligi emirle bitiren Lig Bitirici alır; ilk 3 ise Podyum da alır', async () => {
    const podium = await finishWith(2, true);
    expect((await award(podium.playerId)).sort()).toEqual(['first_order', 'league_finisher', 'podium']);

    const fourth = await finishWith(4, true);
    expect((await award(fourth.playerId)).sort()).toEqual(['first_order', 'league_finisher']);
  });

  it('hiç emir vermeden birinci olmak rozet vermez (K-011 ödül kuralıyla aynı)', async () => {
    const idle = await finishWith(1, false);
    expect(await award(idle.playerId)).toEqual([]);
  });

  it('arkadaş ligi Lig Bitirici ve Podyum saymaz', async () => {
    const [friends] = await ctx.db
      .insert(leagues)
      .values({
        tenantId,
        name: 'gami-friends',
        type: 'friends',
        status: 'finished',
        closedAt: NOW,
        startsAt: new Date('2026-09-01T00:00:00Z'),
        endsAt: new Date('2026-09-10T00:00:00Z'),
        startingCash: '1000.00',
        assetIds: [asset.bank],
        inviteCode: randomUUID().slice(0, 10).toUpperCase(),
        maxMembers: 10,
      })
      .returning({ id: leagues.id });
    const p = await finishWith(1, true, friends!.id);
    expect(await award(p.playerId)).toEqual(['first_order']);
  });

  it('sürmekte olan ligin geçici sırası rozet vermez', async () => {
    const p = await newPlayer(leagueId);
    await ctx.db
      .update(memberships)
      .set({ finalRank: 1, finalValue: '1000.00' })
      .where(eq(memberships.id, p.membershipId));
    await order(p.membershipId, asset.bank);
    expect(await award(p.playerId)).toEqual(['first_order']);
  });

  it('kapanışı bekleyen (sırası yazılmamış) lig rozet vermez', async () => {
    const p = await finishWith(null, true);
    expect(await award(p.playerId)).toEqual(['first_order']);
  });
});

describe('Tavan Avcısı', () => {
  /** Türkiye saatiyle verilen an. */
  const tr = (iso: string) => new Date(`${iso}+03:00`);

  it('tavanda kapanan hisseden o seansta alış yapan kazanır', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank, 'buy', tr(`${LIMIT_DAY}T11:00:00`));
    expect(await award(p.playerId)).toContain('limit_up_hunter');
  });

  it('Türkiye gününün ilk ve son dakikası da aynı gündür', async () => {
    const early = await newPlayer();
    await order(early.membershipId, asset.bank, 'buy', tr(`${LIMIT_DAY}T00:00:00`));
    expect(await award(early.playerId)).toContain('limit_up_hunter');

    const late = await newPlayer();
    await order(late.membershipId, asset.bank, 'buy', tr(`${LIMIT_DAY}T23:59:59`));
    expect(await award(late.playerId)).toContain('limit_up_hunter');
  });

  it('bir önceki ya da sonraki gündeki alış kazandırmaz', async () => {
    const before = await newPlayer();
    await order(before.membershipId, asset.bank, 'buy', tr('2026-09-21T23:59:59'));
    expect(await award(before.playerId)).not.toContain('limit_up_hunter');

    const after = await newPlayer();
    await order(after.membershipId, asset.bank, 'buy', tr('2026-09-23T00:00:00'));
    expect(await award(after.playerId)).not.toContain('limit_up_hunter');
  });

  it('satış, tabanda kapanan hisse ve başka bir hisse kazandırmaz', async () => {
    const sell = await newPlayer();
    await order(sell.membershipId, asset.bank, 'sell', tr(`${LIMIT_DAY}T11:00:00`));
    expect(await award(sell.playerId)).not.toContain('limit_up_hunter');

    const down = await newPlayer();
    await order(down.membershipId, asset.energy, 'buy', tr(`${LIMIT_DAY}T11:00:00`));
    expect(await award(down.playerId)).not.toContain('limit_up_hunter');

    const other = await newPlayer();
    await order(other.membershipId, asset.defense, 'buy', tr(`${LIMIT_DAY}T11:00:00`));
    expect(await award(other.playerId)).not.toContain('limit_up_hunter');
  });

  it('başka platformun tavan günü sayılmaz', async () => {
    // Yabancı platformun hissesi aynı gün tavanda kapandı; bu platformun oyuncusunun emri onunla eşleşmez.
    await ctx.db
      .insert(assetLimitDays)
      .values({ assetId: asset.foreign, tenantId: otherTenantId, sessionDate: LIMIT_DAY, kind: 'limit_up' });
    const p = await newPlayer();
    await order(p.membershipId, asset.foreign, 'buy', tr(`${LIMIT_DAY}T11:00:00`));
    expect(await award(p.playerId)).not.toContain('limit_up_hunter');
  });
});

describe('tenant izolasyonu (NFR-03)', () => {
  it('başka tenant kimliğiyle değerlendirme oyuncuya rozet yazmaz', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank);
    expect(await award(p.playerId, otherTenantId)).toEqual([]);
    expect(await badgesOf(p.playerId)).toEqual([]);
  });

  it('profil ve görünüm okuması başka tenant için oyuncuyu göstermez', async () => {
    const p = await newPlayer();
    const repo = new DrizzleProfileRepository(ctx.db);
    expect(await repo.find(otherTenantId, p.playerId)).toBeNull();
    expect(await repo.find(tenantId, p.playerId)).not.toBeNull();
    expect((await new DrizzleAppearanceReader(ctx.db).find(otherTenantId, [p.playerId])).size).toBe(0);
  });
});

describe('rozet tekilliği (yarış koşulu)', () => {
  it('eşzamanlı 12 değerlendirmede her rozet bir kez yazılır ve bir kez bildirilir', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank, 'buy', new Date('2026-09-22T08:00:00Z'));
    await order(p.membershipId, asset.energy);
    await order(p.membershipId, asset.defense);

    const results = await Promise.all(Array.from({ length: 12 }, () => award(p.playerId)));
    const reported = results.flat().sort();

    const stored = await ctx.db.select().from(playerBadges).where(eq(playerBadges.playerId, p.playerId));
    expect(stored.map((r) => r.badgeId).sort()).toEqual([
      'diverse_portfolio',
      'first_order',
      'limit_up_hunter',
    ]);
    expect(reported).toEqual(['diverse_portfolio', 'first_order', 'limit_up_hunter']);
  });

  it('tekrar değerlendirme yeni rozet üretmez ve kazanma zamanını değiştirmez', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank);
    await awardBadges(ctx.db, tenantId, p.playerId, new Date('2026-09-23T09:00:00Z'));
    expect(await awardBadges(ctx.db, tenantId, p.playerId, new Date('2026-10-01T09:00:00Z'))).toEqual([]);
    const [row] = await ctx.db.select().from(playerBadges).where(eq(playerBadges.playerId, p.playerId));
    expect(row?.earnedAt.toISOString()).toBe('2026-09-23T09:00:00.000Z');
  });

  it('kaynak emir silinse de kazanılan rozet kalır', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank);
    await award(p.playerId);
    await ctx.db.delete(virtualOrders).where(eq(virtualOrders.membershipId, p.membershipId));
    await award(p.playerId);
    expect(await badgesOf(p.playerId)).toEqual(['first_order']);
  });

  it('bilinmeyen rozet kimliği veritabanı kısıtıyla reddedilir', async () => {
    const p = await newPlayer();
    await expect(
      ctx.db.insert(playerBadges).values({ playerId: p.playerId, badgeId: 'altin_rozet' }),
    ).rejects.toThrow();
  });
});

describe('unvan ve çerçeve seçimi', () => {
  const repo = () => new DrizzleProfileRepository(ctx.db);
  const service = () => new ProfileService(repo());

  const readSelection = async (playerId: string) =>
    (
      await ctx.db
        .select({ title: players.selectedTitle, frame: players.selectedFrame })
        .from(players)
        .where(eq(players.id, playerId))
    )[0]!;

  it('kazanılmamış çerçeve seçilemez ve seçim yazılmaz', async () => {
    const p = await newPlayer();
    await expect(service().setAppearance(tenantId, p.playerId, { frame: 'limit_up' })).rejects.toMatchObject({
      status: 403,
    });
    expect(await readSelection(p.playerId)).toEqual({ title: null, frame: null });
  });

  it('kazanılan çerçeve seçilir, kaldırılır', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank);
    await award(p.playerId);

    const chosen = await service().setAppearance(tenantId, p.playerId, { frame: 'starter' });
    expect(chosen.frames.find((f) => f.selected)?.id).toBe('starter');
    const cleared = await service().setAppearance(tenantId, p.playerId, { frame: null });
    expect(cleared.frames.some((f) => f.selected)).toBe(false);
  });

  it('XP eşiğine ulaşılmamış unvan seçilemez, ulaşılınca seçilir', async () => {
    const p = await newPlayer();
    await expect(service().setAppearance(tenantId, p.playerId, { title: 'novice' })).rejects.toMatchObject({
      status: 403,
    });
    await ctx.db.update(players).set({ xp: 150 }).where(eq(players.id, p.playerId));
    const profile = await service().setAppearance(tenantId, p.playerId, { title: 'novice' });
    expect(profile.titles.find((t) => t.selected)?.id).toBe('novice');
  });

  it('kısmen sahip olunan istek hiçbir alanı yazmaz', async () => {
    const p = await newPlayer();
    await ctx.db.update(players).set({ xp: 150 }).where(eq(players.id, p.playerId));
    await expect(
      service().setAppearance(tenantId, p.playerId, { title: 'novice', frame: 'laurel' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await readSelection(p.playerId)).toEqual({ title: null, frame: null });
  });

  it('başka platformun oyuncusunun seçimi değişmez (NFR-03)', async () => {
    const p = await newPlayer();
    await ctx.db.update(players).set({ xp: 150 }).where(eq(players.id, p.playerId));
    await expect(
      service().setAppearance(otherTenantId, p.playerId, { title: 'novice' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await readSelection(p.playerId)).toEqual({ title: null, frame: null });
  });

  it('veritabanı, kataloğ dışı seçimi kısıtla reddeder', async () => {
    const p = await newPlayer();
    await expect(
      ctx.db.update(players).set({ selectedFrame: 'altin' }).where(eq(players.id, p.playerId)),
    ).rejects.toThrow();
  });
});

describe('outbox worker ile kazanım (K-013)', () => {
  it('olay işlenince rozet yazılır, olay bir daha işlenmez', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank);
    await ctx.db.insert(outboxEvents).values({ tenantId, playerId: p.playerId, type: 'badge_recheck' });

    // Docker saati Node saatinden biraz ileri olabilir; olay `available_at` ile şimdiyi karşılaştırır. Bir dakika pay.
    const worker = new OutboxWorker(ctx.db, env, () => Date.now() + 60_000);
    while ((await worker.runOnce()) > 0) {
      /* parti bitene kadar */
    }
    expect(await badgesOf(p.playerId)).toEqual(['first_order']);

    const pending = await ctx.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.playerId, p.playerId), eq(outboxEvents.type, 'badge_recheck')));
    expect(pending).toHaveLength(1);
  });
});

describe('lig kapanışı sinyali', () => {
  it('kapanış transaction’ı ligin bütün üyeleri için yeniden değerlendirme olayı yazar', async () => {
    const a = await newPlayer(finishedLeagueId);
    const b = await newPlayer(finishedLeagueId);
    await new DrizzleLeagueCloseUnitOfWork(ctx.db).run((tx) => tx.enqueueBadgeChecks(finishedLeagueId));

    for (const p of [a, b]) {
      const rows = await ctx.db
        .select({ type: outboxEvents.type, tenantId: outboxEvents.tenantId })
        .from(outboxEvents)
        .where(eq(outboxEvents.playerId, p.playerId));
      expect(rows).toEqual([{ type: 'badge_recheck', tenantId }]);
    }
  });
});
