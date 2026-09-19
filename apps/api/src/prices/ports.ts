/**
 * Fiyat modülünün dış dünyayla konuştuğu arayüzler (FR-30). Gerçekte Redis, PostgreSQL ve HTTP;
 * testlerde bellek içi sahteler.
 */

export interface StoredPrice {
  symbol: string;
  price: string;
  /** Fiyatın platformda oluştuğu an, milisaniye. */
  timestamp: number;
}

export interface PriceStore {
  /**
   * Her sembol için yalnızca elimizdekinden daha yeni bir fiyat yazılır. Eski bir fiyatın geç gelmesi
   * ya da tekrar gönderilmesi son fiyatı geriye çekemez (T2). Yazılan fiyat sayısını döner.
   */
  saveIfNewer(tenantId: string, prices: StoredPrice[]): Promise<number>;
  getLatest(tenantId: string, symbols: string[]): Promise<Map<string, StoredPrice>>;
}

export interface EquityAsset {
  symbol: string;
  /** Son seans kapanışı; tavan/taban bunun ±%10'u. Yeni varlıkta null. */
  referenceClose: string | null;
  /** Kapanışın ait olduğu seans günü (Türkiye takvimi, yyyy-mm-dd). */
  referenceCloseDate: string | null;
}

export interface PriceFeedSource {
  tenantId: string;
  url: string;
  /** Bu platformun lig varlıkları. Akışta başka sembol gelirse saklanmaz. */
  symbols: ReadonlySet<string>;
  /** Hisse varlıkları: seans saati ve tavan/taban yalnızca bunlara uygulanır. */
  equities: ReadonlyMap<string, EquityAsset>;
}

export interface AssetCloseRepository {
  /** Seans kapanış fiyatlarını varlıklara yazar; yalnızca tarihi eski olan satırlar güncellenir. */
  saveCloses(
    tenantId: string,
    sessionDate: string,
    closes: readonly { symbol: string; close: string }[],
  ): Promise<number>;
}

export interface PriceFeedDirectory {
  listSources(): Promise<PriceFeedSource[]>;
}

export interface PriceFeedClient {
  /** Uç noktadan JSON gövdeyi okur. Zaman aşımı, boyut sınırı ve yönlendirme reddi uygulanır. */
  fetchJson(url: string): Promise<unknown>;
}

export const PRICE_STORE = Symbol('PRICE_STORE');
export const PRICE_FEED_DIRECTORY = Symbol('PRICE_FEED_DIRECTORY');
export const PRICE_FEED_CLIENT = Symbol('PRICE_FEED_CLIENT');
export const ASSET_CLOSE_REPOSITORY = Symbol('ASSET_CLOSE_REPOSITORY');
