import { Inject, Injectable, Logger } from '@nestjs/common';
import { isPriceStale, priceFeedResponse, priceTick } from '@lig/shared';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { PriceFeedError } from './http-feed.client';
import {
  PRICE_FEED_CLIENT,
  PRICE_STORE,
  type PriceFeedClient,
  type PriceFeedSource,
  type PriceStore,
  type StoredPrice,
} from './ports';

/** Platform saatinin bizden en fazla bu kadar ileride olmasına tolerans gösterilir. */
export const MAX_FUTURE_SKEW_MS = 2_000;

export type RejectReason = 'invalid' | 'unknown_symbol' | 'future' | 'stale';

export type IngestResult =
  | { ok: true; received: number; saved: number; rejected: Partial<Record<RejectReason, number>> }
  | { ok: false; error: string };

/**
 * Bir platformun fiyat akışını bir kez okur, doğrular ve saklar (FR-30).
 *
 * Güvenmediğimiz girdi olarak ele alınır: her fiyat ayrı doğrulanır, lig varlığı olmayan semboller,
 * gelecekten gelen ya da zaten bayat fiyatlar saklanmaz. Bir fiyatın bozuk gelmesi diğerlerini düşürmez.
 */
@Injectable()
export class PriceIngestService {
  private readonly logger = new Logger(PriceIngestService.name);
  /** Akış her saniye okunur; aynı hatayı her saniye loglamamak için yalnızca durum değişimi loglanır. */
  private readonly lastError = new Map<string, string | null>();

  constructor(
    @Inject(PRICE_FEED_CLIENT) private readonly client: PriceFeedClient,
    @Inject(PRICE_STORE) private readonly store: PriceStore,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  async ingest(source: PriceFeedSource): Promise<IngestResult> {
    let body: unknown;
    try {
      body = await this.client.fetchJson(source.url);
    } catch (err) {
      return this.fail(source, err instanceof PriceFeedError ? err.message : 'unexpected error');
    }

    const parsed = priceFeedResponse.safeParse(body);
    if (!parsed.success) return this.fail(source, 'response does not match the feed schema');

    const now = this.clock();
    const rejected: Partial<Record<RejectReason, number>> = {};
    const reject = (reason: RejectReason) => {
      rejected[reason] = (rejected[reason] ?? 0) + 1;
    };

    const latest = new Map<string, StoredPrice>();
    for (const raw of parsed.data.ticks) {
      const tick = priceTick.safeParse(raw);
      if (!tick.success) {
        reject('invalid');
        continue;
      }
      const { symbol, price, timestamp } = tick.data;
      if (!source.symbols.has(symbol)) reject('unknown_symbol');
      else if (timestamp > now + MAX_FUTURE_SKEW_MS) reject('future');
      else if (isPriceStale(timestamp, now)) reject('stale');
      else if ((latest.get(symbol)?.timestamp ?? -1) < timestamp) {
        latest.set(symbol, { symbol, price, timestamp });
      }
    }

    const saved = await this.store.saveIfNewer(source.tenantId, [...latest.values()]);

    if (this.lastError.get(source.tenantId)) {
      this.logger.log(`Price feed recovered for tenant ${source.tenantId}`);
    }
    this.lastError.set(source.tenantId, null);
    if (rejected.future || rejected.invalid) {
      this.logger.debug(`Rejected ticks for tenant ${source.tenantId}: ${JSON.stringify(rejected)}`);
    }

    return { ok: true, received: parsed.data.ticks.length, saved, rejected };
  }

  private fail(source: PriceFeedSource, error: string): IngestResult {
    if (this.lastError.get(source.tenantId) !== error) {
      // Adres loglanmaz: sorgu parametresinde platformun verdiği bir anahtar olabilir.
      this.logger.warn(`Price feed failed for tenant ${source.tenantId}: ${error}`);
    }
    this.lastError.set(source.tenantId, error);
    return { ok: false, error };
  }
}
