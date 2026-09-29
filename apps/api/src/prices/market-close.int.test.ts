import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets, tenants } from '../db/schema';
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
