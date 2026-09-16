import { describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env';
import { FakeFeedClient, FakeFeedDirectory, InMemoryPriceStore, NOW_MS } from './fakes.test-utils';
import { PriceIngestService } from './price-ingest.service';
import { PriceIngestWorker, SOURCES_REFRESH_MS } from './price-ingest.worker';

const env = parseEnv({ DATABASE_URL: 'postgres://x@localhost/x', REDIS_URL: 'redis://localhost' });

function setup(overrides: Partial<typeof env> = {}) {
  let now = NOW_MS;
  const urlA = 'http://a.test/prices';
  const urlB = 'http://b.test/prices';
  const client = new FakeFeedClient({
    [urlA]: { ticks: [{ symbol: 'BTC', price: '1', timestamp: NOW_MS }] },
    [urlB]: new Error('platform B is down'),
  });
  const store = new InMemoryPriceStore();
  const directory = new FakeFeedDirectory([
    { tenantId: 'a', url: urlA, symbols: new Set(['BTC']) },
    { tenantId: 'b', url: urlB, symbols: new Set(['BTC']) },
  ]);
  const clock = () => now;
  const worker = new PriceIngestWorker(
    new PriceIngestService(client, store, clock),
    directory,
    { ...env, ...overrides },
    clock,
  );
  return { worker, client, store, directory, advance: (ms: number) => (now += ms) };
}

describe('PriceIngestWorker', () => {
  it('ingests every tenant; one failing platform does not block the others', async () => {
    const { worker, client, store } = setup();
    await worker.runOnce();
    expect(client.calls).toHaveLength(2);
    expect((await store.getLatest('a', ['BTC'])).get('BTC')?.price).toBe('1');
  });

  it('caches the source list and refreshes it periodically', async () => {
    const { worker, directory, advance } = setup();
    await worker.runOnce();
    advance(1_000);
    await worker.runOnce();
    expect(directory.calls).toBe(1);

    advance(SOURCES_REFRESH_MS);
    await worker.runOnce();
    expect(directory.calls).toBe(2);
  });

  it('does not start when workers are disabled', () => {
    const { worker, client } = setup({ WORKERS_ENABLED: false });
    worker.onApplicationBootstrap();
    worker.onApplicationShutdown();
    expect(client.calls).toHaveLength(0);
  });
});
