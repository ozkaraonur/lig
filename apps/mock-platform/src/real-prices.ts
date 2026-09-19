import { type PriceTick } from '@lig/shared';
import { z } from 'zod';
import { type PriceSimulator } from './prices.js';

/**
 * Demo için gerçek kripto fiyatı (Faz 2, 8. adım). Sahte platform, halka açık bir borsa fiyat ucundan
 * TL paritelerini okur ve lig modülünün beklediği tick şemasında yayınlar. Modülün sözleşmesi (FR-30)
 * değişmez: pilotta bu işi gerçek platform yapacak.
 *
 * Varsayılan kaynak BtcTurk'ün halka açık ticker ucu: anahtar istemez, TL pariteleri vardır ve
 * `/api/v2/ticker` için belgelenmiş limit 100 ms'de 10 istektir. Biz tek istekte bütün pariteleri
 * alıp önbelleğe koyuyoruz ve varsayılan olarak 2 saniyede bir yeniliyoruz.
 */
export const DEFAULT_REAL_PRICE_URL = 'https://api.btcturk.com/api/v2/ticker';

/** Lig varlığı → borsadaki parite. Yanıtta olmayan parite yayınlanmaz. */
export const DEFAULT_PAIRS: Record<string, string> = {
  BTC: 'BTCTRY',
  ETH: 'ETHTRY',
  SOL: 'SOLTRY',
  AVAX: 'AVAXTRY',
  XRP: 'XRPTRY',
  DOGE: 'DOGETRY',
};

/** Yanıtın yalnızca kullandığımız alanları; fazlası yok sayılır. */
const tickerResponse = z.object({
  data: z.array(z.object({ pair: z.string(), last: z.union([z.number(), z.string()]) })),
});

export interface RealPriceFeedOptions {
  url?: string;
  pairs?: Record<string, string>;
  /** Kaynağın yenilenme aralığı. Lig API'si fiyatı 5 saniyeden eskiyse bayat sayar (MAX_PRICE_AGE_MS). */
  refreshMs?: number;
  timeoutMs?: number;
  fetchJson?: (url: string, timeoutMs: number) => Promise<unknown>;
  now?: () => number;
}

export type PriceMode = 'simulated' | 'real';

export interface PriceSourceStatus {
  mode: PriceMode;
  /** Gerçek modda: son başarılı okuma anı ve varsa son hata. */
  lastSuccessAt: number | null;
  lastError: string | null;
  /** Gerçek fiyat hiç gelmediyse simülasyona düşülür; demo boş ekranla başlamaz. */
  fallback: boolean;
  source: string;
}

async function defaultFetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Gerçek fiyatları çeker ve önbellekte tutar. Uç nokta yavaşlar ya da bozulursa son bilinen fiyat
 * yayınlanmaya devam eder; hiç fiyat alınamadıysa simülatöre düşülür.
 */
export class RealPriceFeed {
  private readonly url: string;
  private readonly pairs: Record<string, string>;
  private readonly refreshMs: number;
  private readonly timeoutMs: number;
  private readonly fetchJson: (url: string, timeoutMs: number) => Promise<unknown>;
  private readonly now: () => number;

  private latest: PriceTick[] = [];
  private lastSuccessAt: number | null = null;
  private lastError: string | null = null;
  private inFlight = false;

  constructor(
    private readonly fallbackSimulator: PriceSimulator,
    options: RealPriceFeedOptions = {},
  ) {
    this.url = options.url ?? DEFAULT_REAL_PRICE_URL;
    this.pairs = options.pairs ?? DEFAULT_PAIRS;
    this.refreshMs = options.refreshMs ?? 2000;
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.now = options.now ?? Date.now;
  }

  /** Bir tur: süresi geldiyse kaynağı okur. Önceki istek bitmediyse yenisini başlatmaz. */
  async refresh(): Promise<void> {
    if (this.inFlight) return;
    if (this.lastSuccessAt !== null && this.now() - this.lastSuccessAt < this.refreshMs) return;
    this.inFlight = true;
    try {
      const parsed = tickerResponse.safeParse(await this.fetchJson(this.url, this.timeoutMs));
      if (!parsed.success) {
        this.lastError = 'yanıt beklenen şemada değil';
        return;
      }
      const byPair = new Map(parsed.data.data.map((row) => [row.pair, row.last]));
      // Zaman damgası olarak kendi okuma anımız kullanılır: borsanın saati bizden ileriyse lig API'si
      // "gelecekten gelen fiyat" diye reddederdi (MAX_FUTURE_SKEW_MS).
      const timestamp = this.now();
      const ticks: PriceTick[] = [];
      for (const [symbol, pair] of Object.entries(this.pairs)) {
        const last = byPair.get(pair);
        if (last === undefined) continue;
        const price = typeof last === 'number' ? last : Number(last);
        if (!Number.isFinite(price) || price <= 0) continue;
        ticks.push({ symbol, price: price.toFixed(priceDecimals(price)), timestamp });
      }
      if (ticks.length === 0) {
        this.lastError = 'yanıtta tanıdık parite yok';
        return;
      }
      this.latest = ticks;
      this.lastSuccessAt = timestamp;
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'bilinmeyen hata';
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Son okunan fiyatlar. Zaman damgası kasten tazelenmez: kaynak susarsa fiyat yaşlanır ve lig API'si
   * 5 saniye sonra "güncel değil" der, emir kabul etmez. Uydurma tazelikten iyidir.
   */
  snapshot(): PriceTick[] {
    if (this.latest.length === 0) return this.fallbackSimulator.snapshot();
    return this.latest;
  }

  status(): PriceSourceStatus {
    return {
      mode: 'real',
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      fallback: this.latest.length === 0,
      source: this.url,
    };
  }
}

/** Fiyat büyüklüğüne göre ondalık: 1 TL altı kuruşun altını da gösterir, büyük fiyatlarda 2 basamak. */
function priceDecimals(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 1) return 4;
  return 6;
}
