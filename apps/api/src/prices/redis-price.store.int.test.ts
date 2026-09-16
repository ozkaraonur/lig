import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectIntegration, type IntegrationContext } from '../test/integration.test-utils';
import { PRICE_RETENTION_MS, priceKey, RedisPriceStore } from './redis-price.store';

let ctx: IntegrationContext;
let store: RedisPriceStore;
const tenant = randomUUID();

beforeAll(() => {
  ctx = connectIntegration();
  store = new RedisPriceStore(ctx.redis);
});

afterAll(async () => {
  const keys = await ctx.redis.keys(`price:${tenant}:*`);
  if (keys.length > 0) await ctx.redis.del(...keys);
  await ctx.close();
});

describe('RedisPriceStore (integration)', () => {
  it('stores and reads the latest price per tenant', async () => {
    await store.saveIfNewer(tenant, [{ symbol: 'BTC', price: '100.5', timestamp: 1_000 }]);
    const latest = await store.getLatest(tenant, ['BTC', 'ETH']);
    expect(latest.get('BTC')).toEqual({ symbol: 'BTC', price: '100.5', timestamp: 1_000 });
    expect(latest.has('ETH')).toBe(false);
    expect((await store.getLatest(randomUUID(), ['BTC'])).size).toBe(0);
  });

  it('refuses older or same-timestamp prices atomically', async () => {
    await store.saveIfNewer(tenant, [{ symbol: 'ETH', price: '20', timestamp: 2_000 }]);
    expect(await store.saveIfNewer(tenant, [{ symbol: 'ETH', price: '10', timestamp: 1_999 }])).toBe(0);
    expect(await store.saveIfNewer(tenant, [{ symbol: 'ETH', price: '11', timestamp: 2_000 }])).toBe(0);
    expect(await store.saveIfNewer(tenant, [{ symbol: 'ETH', price: '30', timestamp: 2_001 }])).toBe(1);
    expect((await store.getLatest(tenant, ['ETH'])).get('ETH')?.price).toBe('30');
  });

  it('keeps the newest price when writers race', async () => {
    const writes = Array.from({ length: 50 }, (_, i) =>
      store.saveIfNewer(tenant, [{ symbol: 'SOL', price: String(i + 1), timestamp: 10_000 + i }]),
    );
    await Promise.all(writes.reverse());
    expect((await store.getLatest(tenant, ['SOL'])).get('SOL')?.price).toBe('50');
  });

  it('expires prices after the retention window', async () => {
    await store.saveIfNewer(tenant, [{ symbol: 'AVAX', price: '1', timestamp: 1 }]);
    const ttl = await ctx.redis.pttl(priceKey(tenant, 'AVAX'));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(PRICE_RETENTION_MS);
  });

  it('treats a corrupted value as missing and lets a new price overwrite it', async () => {
    await ctx.redis.set(priceKey(tenant, 'XRP'), 'not-json');
    expect((await store.getLatest(tenant, ['XRP'])).size).toBe(0);
    expect(await store.saveIfNewer(tenant, [{ symbol: 'XRP', price: '2', timestamp: 5 }])).toBe(1);
  });
});
