import { beforeEach, describe, expect, it } from 'vitest';
import { PriceSimulator } from './prices.js';
import { RealPriceFeed } from './real-prices.js';

/** Gerçek fiyat modu (Faz 2, 8. adım). Ağ yok: kaynak enjekte edilir. */
const NOW = 1_800_000_000_000;
let now: number;
let simulator: PriceSimulator;
let calls: string[];

const body = (rows: Array<{ pair: string; last: number | string }>) => ({ data: rows });

const feed = (
  respond: (url: string) => unknown,
  options: Partial<ConstructorParameters<typeof RealPriceFeed>[1]> = {},
) =>
  new RealPriceFeed(simulator, {
    url: 'http://borsa.test/ticker',
    fetchJson: async (url) => {
      calls.push(url);
      const result = respond(url);
      if (result instanceof Error) throw result;
      return result;
    },
    now: () => now,
    ...options,
  });

beforeEach(() => {
  now = NOW;
  calls = [];
  simulator = new PriceSimulator(
    undefined,
    () => 0.5,
    () => NOW,
  );
});

describe('RealPriceFeed', () => {
  it('tanıdık pariteleri lig şemasına çevirir', async () => {
    const source = feed(() =>
      body([
        { pair: 'BTCTRY', last: 4_250_000 },
        { pair: 'ETHTRY', last: '152345.67' },
        { pair: 'DOGETRY', last: 0.912345 },
        { pair: 'XYZTRY', last: 5 },
      ]),
    );
    await source.refresh();

    const ticks = source.snapshot();
    expect(ticks).toEqual([
      { symbol: 'BTC', price: '4250000.00', timestamp: NOW },
      { symbol: 'ETH', price: '152345.67', timestamp: NOW },
      { symbol: 'DOGE', price: '0.912345', timestamp: NOW },
    ]);
    // Tanımadığımız parite yayınlanmaz, eksik parite de sorun değil.
    expect(ticks.map((t) => t.symbol)).not.toContain('XYZ');
    expect(source.status()).toMatchObject({ mode: 'real', lastError: null, fallback: false });
  });

  it('zaman damgası kendi okuma anımızdır, borsanınki değil', async () => {
    const source = feed(() => body([{ pair: 'BTCTRY', last: 1000 }]));
    await source.refresh();
    // Borsanın saati ileri olsa da lig API'si "gelecekten fiyat" diye reddetmesin.
    expect(source.snapshot()[0]?.timestamp).toBe(NOW);
  });

  it('yenileme aralığı dolmadan tekrar istek atmaz', async () => {
    const source = feed(() => body([{ pair: 'BTCTRY', last: 1000 }]), { refreshMs: 2000 });
    await source.refresh();
    now += 500;
    await source.refresh();
    expect(calls).toHaveLength(1);

    now += 2000;
    await source.refresh();
    expect(calls).toHaveLength(2);
  });

  it('kaynak hata verirse son bilinen fiyat yayınlanmaya devam eder', async () => {
    let fail = false;
    const source = feed(() => (fail ? new Error('timeout') : body([{ pair: 'BTCTRY', last: 1000 }])));
    await source.refresh();

    fail = true;
    now += 5000;
    await source.refresh();

    expect(source.snapshot()).toEqual([{ symbol: 'BTC', price: '1000.00', timestamp: NOW }]);
    expect(source.status().lastError).toBe('timeout');
    // Zaman damgası tazelenmez: fiyat yaşlanır, lig API'si onu bayat sayar ve emir kabul etmez.
    expect(source.snapshot()[0]?.timestamp).toBeLessThan(now);
  });

  it('hiç fiyat alınamadıysa simülasyona düşer', async () => {
    const source = feed(() => new Error('bağlanılamadı'));
    await source.refresh();

    const ticks = source.snapshot();
    expect(ticks.map((t) => t.symbol)).toEqual(simulator.snapshot().map((t) => t.symbol));
    expect(source.status()).toMatchObject({ fallback: true, lastError: 'bağlanılamadı' });
  });

  it.each([
    ['beklenmeyen gövde', { result: [] }, 'yanıt beklenen şemada değil'],
    ['gövde dizi değil', 'merhaba', 'yanıt beklenen şemada değil'],
    ['tanıdık parite yok', { data: [{ pair: 'AAABBB', last: 1 }] }, 'yanıtta tanıdık parite yok'],
  ])('bozuk yanıtı yutar: %s', async (_label, response, error) => {
    const source = feed(() => response);
    await source.refresh();
    expect(source.status()).toMatchObject({ fallback: true, lastError: error });
  });

  it('geçersiz fiyatları atar', async () => {
    const source = feed(() =>
      body([
        { pair: 'BTCTRY', last: 0 },
        { pair: 'ETHTRY', last: 'abc' },
        { pair: 'SOLTRY', last: -5 },
        { pair: 'AVAXTRY', last: 1234.5 },
      ]),
    );
    await source.refresh();
    expect(source.snapshot()).toEqual([{ symbol: 'AVAX', price: '1234.50', timestamp: NOW }]);
  });
});
