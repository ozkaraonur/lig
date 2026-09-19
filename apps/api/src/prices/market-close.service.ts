import { Inject, Injectable, Logger } from '@nestjs/common';
import { lastSessionClose, marketStatus, trDate } from '@lig/shared';
import { CLOCK_MS, type MsClock } from '../common/clock';
import {
  ASSET_CLOSE_REPOSITORY,
  type AssetCloseRepository,
  PRICE_STORE,
  type PriceFeedSource,
  type PriceStore,
} from './ports';

/**
 * Seans kapandıktan sonra o günün kapanış fiyatını varlığa yazar. Ertesi günün tavan/tabanı buradan
 * hesaplanır ve seans dışında oyuncuya gösterilen fiyat da budur.
 *
 * Fiyat akışı okunurken çağrılır; ayrı bir worker'a gerek yok. Aynı seans günü için iki kez yazılmaz:
 * tarih varlık satırında tutulur, ayrıca süreç içinde kısa bir hatırlatma tutulur ki kapanıştan sonra
 * her saniye veritabanına gidilmesin.
 */
@Injectable()
export class MarketCloseService {
  private readonly logger = new Logger(MarketCloseService.name);
  /** tenantId → yazımı tamamlanan son seans günü. */
  private readonly recorded = new Map<string, string>();

  constructor(
    @Inject(ASSET_CLOSE_REPOSITORY) private readonly repository: AssetCloseRepository,
    @Inject(PRICE_STORE) private readonly store: PriceStore,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  /** Yazılan kapanış sayısını döner. Seans açıkken ya da yazacak bir şey yokken 0. */
  async recordIfSessionEnded(source: PriceFeedSource): Promise<number> {
    if (source.equities.size === 0) return 0;
    const now = new Date(this.clock());
    if (marketStatus(now).open) return 0;

    const session = lastSessionClose(now);
    if (!session) return 0;
    /**
     * Yalnızca bugünün kendi kapanışı yazılır. Öğle arasında ya da seans açılmadan önce de "seans kapalı"
     * görünür; o anda son seans günü dünkü gündür ve bugünün canlı fiyatı dünün kapanışı olarak yazılamaz.
     * API dün akşam kapalıysa o günün kapanışı boş kalır: limit uygulanmaması, uydurma limitten iyidir.
     */
    if (session.date !== trDate(now)) return 0;
    if (this.recorded.get(source.tenantId) === session.date) return 0;

    const pending = [...source.equities.values()].filter((a) => a.referenceCloseDate !== session.date);
    if (pending.length === 0) {
      this.recorded.set(source.tenantId, session.date);
      return 0;
    }

    const prices = await this.store.getLatest(
      source.tenantId,
      pending.map((a) => a.symbol),
    );
    const closes = pending.flatMap((asset) => {
      const price = prices.get(asset.symbol);
      return price ? [{ symbol: asset.symbol, close: price.price }] : [];
    });
    if (closes.length === 0) return 0;

    const saved = await this.repository.saveCloses(source.tenantId, session.date, closes);
    // Fiyatı hiç gelmemiş varlık varsa tekrar denenebilsin diye ancak hepsi yazıldığında işaretlenir.
    if (closes.length === pending.length) this.recorded.set(source.tenantId, session.date);
    if (saved > 0) {
      this.logger.log(`Session close recorded for tenant ${source.tenantId} (${session.date}): ${saved}`);
    }
    return saved;
  }
}
