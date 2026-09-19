import { beforeEach, describe, expect, it } from 'vitest';
import { FakeAssetCloseRepository, InMemoryPriceStore } from './fakes.test-utils';
import { MarketCloseService } from './market-close.service';
import { type PriceFeedSource } from './ports';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OPEN = new Date('2026-09-22T11:00:00+03:00').getTime();
const AFTER_CLOSE = new Date('2026-09-22T18:30:00+03:00').getTime();

let now: number;
let store: InMemoryPriceStore;
let repository: FakeAssetCloseRepository;
let service: MarketCloseService;

const source = (referenceCloseDate: string | null): PriceFeedSource => ({
  tenantId: TENANT,
  url: 'http://feed.test',
  symbols: new Set(['THYAO']),
  equities: new Map([['THYAO', { symbol: 'THYAO', referenceClose: '100', referenceCloseDate }]]),
});

beforeEach(async () => {
  now = AFTER_CLOSE;
  store = new InMemoryPriceStore();
  repository = new FakeAssetCloseRepository();
  service = new MarketCloseService(repository, store, () => now);
  await store.saveIfNewer(TENANT, [{ symbol: 'THYAO', price: '123.45', timestamp: OPEN }]);
});

describe('MarketCloseService', () => {
  it('seans kapandıktan sonra son fiyatı kapanış olarak yazar', async () => {
    expect(await service.recordIfSessionEnded(source('2026-09-21'))).toBe(1);
    expect(repository.closes.get(`${TENANT}:THYAO`)).toEqual({
      sessionDate: '2026-09-22',
      close: '123.45',
    });
  });

  it('seans açıkken yazmaz', async () => {
    now = OPEN;
    expect(await service.recordIfSessionEnded(source('2026-09-21'))).toBe(0);
    expect(repository.closes.size).toBe(0);
  });

  it('aynı gün için ikinci kez veritabanına gitmez', async () => {
    const input = source('2026-09-21');
    expect(await service.recordIfSessionEnded(input)).toBe(1);
    // Kaynak listesi henüz yenilenmediği için tarih hâlâ eski görünüyor; yine de tekrar yazılmaz.
    expect(await service.recordIfSessionEnded(input)).toBe(0);
  });

  it('kapanışı zaten yazılmış varlığı atlar', async () => {
    expect(await service.recordIfSessionEnded(source('2026-09-22'))).toBe(0);
    expect(repository.closes.size).toBe(0);
  });

  it('hisse varlığı olmayan platformda çalışmaz', async () => {
    const cryptoOnly: PriceFeedSource = {
      tenantId: TENANT,
      url: 'http://feed.test',
      symbols: new Set(['BTC']),
      equities: new Map(),
    };
    expect(await service.recordIfSessionEnded(cryptoOnly)).toBe(0);
  });

  it('fiyatı hiç gelmemiş varlıkta yazmaz ve tekrar denenebilir', async () => {
    const empty = new InMemoryPriceStore();
    const retryService = new MarketCloseService(repository, empty, () => now);
    expect(await retryService.recordIfSessionEnded(source('2026-09-21'))).toBe(0);

    await empty.saveIfNewer(TENANT, [{ symbol: 'THYAO', price: '99', timestamp: OPEN }]);
    expect(await retryService.recordIfSessionEnded(source('2026-09-21'))).toBe(1);
  });

  it('hafta sonunda cumanın kapanışı geriye dönük yazılmaz', async () => {
    // Cumanın kapanışı cuma 18:00'de yazılır. Pazar günü elimizdeki fiyat o kapanış olmayabilir.
    now = new Date('2026-09-27T12:00:00+03:00').getTime();
    const weekend = new MarketCloseService(repository, store, () => now);
    expect(await weekend.recordIfSessionEnded(source(null))).toBe(0);
    expect(repository.closes.size).toBe(0);
  });
});

describe('MarketCloseService, yanlış güne yazma koruması', () => {
  it('öğle arasında dünün kapanışı olarak bugünün fiyatını yazmaz', async () => {
    now = new Date('2026-09-22T13:30:00+03:00').getTime();
    const lunchService = new MarketCloseService(repository, store, () => now);
    expect(await lunchService.recordIfSessionEnded(source(null))).toBe(0);
    expect(repository.closes.size).toBe(0);
  });

  it('seans açılmadan önce de yazmaz', async () => {
    now = new Date('2026-09-22T09:30:00+03:00').getTime();
    const beforeOpen = new MarketCloseService(repository, store, () => now);
    expect(await beforeOpen.recordIfSessionEnded(source(null))).toBe(0);
  });

  it('kapanıştan sonra bugünün tarihiyle yazar', async () => {
    now = new Date('2026-09-22T18:05:00+03:00').getTime();
    const afterClose = new MarketCloseService(repository, store, () => now);
    expect(await afterClose.recordIfSessionEnded(source(null))).toBe(1);
    expect(repository.closes.get(`${TENANT}:THYAO`)?.sessionDate).toBe('2026-09-22');
  });
});
