import {
  type AssetCloseRepository,
  type PriceFeedClient,
  type PriceFeedDirectory,
  type PriceFeedSource,
  type PriceStore,
  type StoredPrice,
} from './ports';

export const NOW_MS = 1_800_000_000_000;

export class InMemoryPriceStore implements PriceStore {
  readonly prices = new Map<string, StoredPrice>();

  async saveIfNewer(tenantId: string, prices: StoredPrice[]): Promise<number> {
    let saved = 0;
    for (const p of prices) {
      const key = `${tenantId}:${p.symbol}`;
      const current = this.prices.get(key);
      if (current && current.timestamp >= p.timestamp) continue;
      this.prices.set(key, p);
      saved++;
    }
    return saved;
  }

  async getLatest(tenantId: string, symbols: string[]): Promise<Map<string, StoredPrice>> {
    const result = new Map<string, StoredPrice>();
    for (const symbol of symbols) {
      const p = this.prices.get(`${tenantId}:${symbol}`);
      if (p) result.set(symbol, p);
    }
    return result;
  }
}

/** Her URL için verilen yanıtı döner; yanıt bir Error ise onu fırlatır. */
export class FakeFeedClient implements PriceFeedClient {
  readonly calls: string[] = [];
  constructor(public responses: Record<string, unknown>) {}

  async fetchJson(url: string): Promise<unknown> {
    this.calls.push(url);
    const response = this.responses[url];
    if (response instanceof Error) throw response;
    return response;
  }
}

export class FakeFeedDirectory implements PriceFeedDirectory {
  calls = 0;
  constructor(public sources: PriceFeedSource[]) {}

  async listSources(): Promise<PriceFeedSource[]> {
    this.calls++;
    return this.sources;
  }
}

/** Kapanış yazımlarını bellekte tutar: sembol → { tarih, kapanış }. */
export class FakeAssetCloseRepository implements AssetCloseRepository {
  readonly closes = new Map<string, { sessionDate: string; close: string }>();

  async saveCloses(
    tenantId: string,
    sessionDate: string,
    closes: readonly { symbol: string; close: string }[],
  ): Promise<number> {
    let saved = 0;
    for (const { symbol, close } of closes) {
      const key = `${tenantId}:${symbol}`;
      const current = this.closes.get(key);
      if (current && current.sessionDate >= sessionDate) continue;
      this.closes.set(key, { sessionDate, close });
      saved += 1;
    }
    return saved;
  }
}
