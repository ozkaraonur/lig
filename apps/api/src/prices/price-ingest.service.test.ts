import { MAX_PRICE_AGE_MS } from '@lig/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeFeedClient, InMemoryPriceStore, NOW_MS } from './fakes.test-utils';
import { PriceFeedError } from './http-feed.client';
import { MAX_FUTURE_SKEW_MS, PriceIngestService } from './price-ingest.service';
import { type PriceFeedSource } from './ports';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const URL_A = 'http://feed.test/prices';
const source: PriceFeedSource = { tenantId: TENANT, url: URL_A, symbols: new Set(['BTC', 'ETH']) };

let client: FakeFeedClient;
let store: InMemoryPriceStore;
let service: PriceIngestService;
let now: number;

const tick = (symbol: string, price: string, timestamp = now) => ({ symbol, price, timestamp });

beforeEach(() => {
  now = NOW_MS;
  client = new FakeFeedClient({});
  store = new InMemoryPriceStore();
  service = new PriceIngestService(client, store, () => now);
});

describe('PriceIngestService (FR-30)', () => {
  it('saves valid prices for the tenant', async () => {
    client.responses[URL_A] = { ticks: [tick('BTC', '4000000.12'), tick('ETH', '150000')] };
    const result = await service.ingest(source);

    expect(result).toEqual({ ok: true, received: 2, saved: 2, rejected: {} });
    const latest = await store.getLatest(TENANT, ['BTC', 'ETH']);
    expect(latest.get('BTC')).toEqual({ symbol: 'BTC', price: '4000000.12', timestamp: now });
  });

  it('keeps prices isolated per tenant', async () => {
    client.responses[URL_A] = { ticks: [tick('BTC', '1')] };
    await service.ingest(source);
    expect((await store.getLatest(OTHER_TENANT, ['BTC'])).size).toBe(0);
  });

  it('ignores symbols that are not assets of this tenant', async () => {
    client.responses[URL_A] = { ticks: [tick('BTC', '1'), tick('SCAM', '999')] };
    const result = await service.ingest(source);
    expect(result).toMatchObject({ ok: true, saved: 1, rejected: { unknown_symbol: 1 } });
    expect((await store.getLatest(TENANT, ['SCAM'])).size).toBe(0);
  });

  it('drops a malformed tick without dropping the rest of the batch', async () => {
    client.responses[URL_A] = {
      ticks: [tick('BTC', '0'), { symbol: 'ETH', price: 12, timestamp: now }, tick('ETH', '10'), 'junk'],
    };
    const result = await service.ingest(source);
    expect(result).toMatchObject({ ok: true, received: 4, saved: 1, rejected: { invalid: 3 } });
  });

  it('rejects prices from the future beyond the clock skew tolerance', async () => {
    client.responses[URL_A] = {
      ticks: [tick('BTC', '1', now + MAX_FUTURE_SKEW_MS), tick('ETH', '1', now + MAX_FUTURE_SKEW_MS + 1)],
    };
    const result = await service.ingest(source);
    expect(result).toMatchObject({ saved: 1, rejected: { future: 1 } });
  });

  it('does not store prices that are already stale', async () => {
    client.responses[URL_A] = { ticks: [tick('BTC', '1', now - MAX_PRICE_AGE_MS - 1)] };
    expect(await service.ingest(source)).toMatchObject({ saved: 0, rejected: { stale: 1 } });
  });

  it('never rolls the latest price back to an older one (T2)', async () => {
    client.responses[URL_A] = { ticks: [tick('BTC', '200', now)] };
    await service.ingest(source);

    client.responses[URL_A] = { ticks: [tick('BTC', '100', now - 1_000)] };
    expect(await service.ingest(source)).toMatchObject({ saved: 0 });
    expect((await store.getLatest(TENANT, ['BTC'])).get('BTC')?.price).toBe('200');
  });

  it('keeps the newest tick when a symbol appears twice in one batch', async () => {
    client.responses[URL_A] = { ticks: [tick('BTC', '2', now), tick('BTC', '1', now - 500)] };
    await service.ingest(source);
    expect((await store.getLatest(TENANT, ['BTC'])).get('BTC')?.price).toBe('2');
  });

  it.each([
    ['a network failure', new PriceFeedError('timeout'), 'timeout'],
    ['an unexpected error', new Error('boom'), 'unexpected error'],
    ['a body without ticks', { prices: [] }, 'response does not match the feed schema'],
    ['a non-object body', 'hello', 'response does not match the feed schema'],
  ])('reports %s without throwing', async (_label, response, error) => {
    client.responses[URL_A] = response;
    expect(await service.ingest(source)).toEqual({ ok: false, error });
  });
});
