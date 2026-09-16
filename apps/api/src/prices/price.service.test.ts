import { MAX_PRICE_AGE_MS } from '@lig/shared';
import { describe, expect, it } from 'vitest';
import { InMemoryPriceStore, NOW_MS } from './fakes.test-utils';
import { PriceService } from './price.service';

describe('PriceService', () => {
  it('marks missing and old prices as stale', async () => {
    const store = new InMemoryPriceStore();
    await store.saveIfNewer('t', [
      { symbol: 'BTC', price: '10', timestamp: NOW_MS - 1_000 },
      { symbol: 'ETH', price: '5', timestamp: NOW_MS - MAX_PRICE_AGE_MS - 1 },
    ]);
    const service = new PriceService(store, () => NOW_MS);

    const result = await service.latestFor('t', [
      { id: 'btc-id', symbol: 'BTC' },
      { id: 'eth-id', symbol: 'ETH' },
      { id: 'sol-id', symbol: 'SOL' },
    ]);

    expect(result).toEqual([
      { assetId: 'btc-id', symbol: 'BTC', price: '10', priceAt: NOW_MS - 1_000, stale: false },
      { assetId: 'eth-id', symbol: 'ETH', price: '5', priceAt: NOW_MS - MAX_PRICE_AGE_MS - 1, stale: true },
      { assetId: 'sol-id', symbol: 'SOL', price: null, priceAt: null, stale: true },
    ]);
  });
});
