import { type PriceTick } from '@lig/shared';

export interface MarketConfig {
  symbol: string;
  /** Başlangıç fiyatı, sanal TL. */
  start: number;
  /** Fiyatın gösterildiği ondalık basamak sayısı. */
  decimals: number;
  /** Her adımdaki tipik oynaklık (0.001 = %0,1). */
  volatility: number;
}

/** Sahte platformun yayınladığı piyasalar. Fiyatlar gerçeği yansıtmaz, sadece hareket etsin diye vardır. */
export const DEFAULT_MARKETS: MarketConfig[] = [
  { symbol: 'BTC', start: 4_000_000, decimals: 2, volatility: 0.0008 },
  { symbol: 'ETH', start: 150_000, decimals: 2, volatility: 0.001 },
  { symbol: 'SOL', start: 7_000, decimals: 2, volatility: 0.0015 },
  { symbol: 'AVAX', start: 1_200, decimals: 2, volatility: 0.0018 },
  { symbol: 'XRP', start: 110, decimals: 4, volatility: 0.0015 },
  { symbol: 'DOGE', start: 9, decimals: 5, volatility: 0.002 },
];

interface MarketState extends MarketConfig {
  price: number;
  timestamp: number;
}

/**
 * Rastgele yürüyüşle fiyat üretir: her adımda fiyat, normal dağılımlı küçük bir oranla çarpılır.
 * `random` ve `now` enjekte edilir; testlerde sabit sonuç verir.
 */
export class PriceSimulator {
  private readonly markets: MarketState[];
  /** Durdurulunca fiyatlar ve zaman damgaları donar; lig API'si 5 sn sonra fiyatları bayat sayar. */
  paused = false;

  constructor(
    markets: MarketConfig[] = DEFAULT_MARKETS,
    private readonly random: () => number = Math.random,
    private readonly now: () => number = Date.now,
  ) {
    const timestamp = this.now();
    this.markets = markets.map((m) => ({ ...m, price: m.start, timestamp }));
  }

  tick(): void {
    if (this.paused) return;
    const timestamp = this.now();
    for (const market of this.markets) {
      const change = Math.exp(market.volatility * this.gaussian());
      // Fiyat başlangıcın %1'i ile 100 katı arasında tutulur: sıfıra inip ya da sonsuza gidip
      // API'nin reddedeceği bir değere ("0.00", "1e+21") dönüşmez.
      market.price = Math.min(Math.max(market.price * change, market.start * 0.01), market.start * 100);
      market.timestamp = timestamp;
    }
  }

  snapshot(): PriceTick[] {
    return this.markets.map((m) => ({
      symbol: m.symbol,
      price: m.price.toFixed(m.decimals),
      timestamp: m.timestamp,
    }));
  }

  /** Box-Muller dönüşümü: iki düzgün dağılımlı sayıdan bir standart normal sayı. */
  private gaussian(): number {
    const u = Math.max(this.random(), Number.EPSILON);
    const v = this.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
