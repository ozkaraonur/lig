import { Inject, Injectable } from '@nestjs/common';
import { isPriceStale, type LeagueAssetPrice } from '@lig/shared';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { PRICE_STORE, type PriceStore } from './ports';

/** Diğer modüllerin son fiyatı okuduğu tek yer. Fiyat asla istemciden alınmaz (T2). */
@Injectable()
export class PriceService {
  constructor(
    @Inject(PRICE_STORE) private readonly store: PriceStore,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  async latestFor(
    tenantId: string,
    assets: Array<{ id: string; symbol: string }>,
  ): Promise<LeagueAssetPrice[]> {
    const prices = await this.store.getLatest(
      tenantId,
      assets.map((a) => a.symbol),
    );
    const now = this.clock();
    return assets.map((asset) => {
      const p = prices.get(asset.symbol);
      return {
        assetId: asset.id,
        symbol: asset.symbol,
        price: p?.price ?? null,
        priceAt: p?.timestamp ?? null,
        stale: p ? isPriceStale(p.timestamp, now) : true,
      };
    });
  }
}
