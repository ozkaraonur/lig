import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { ENV, type Env } from '../config/env';
import { PriceIngestService } from './price-ingest.service';
import { PRICE_FEED_DIRECTORY, type PriceFeedDirectory, type PriceFeedSource } from './ports';

/** Yeni eklenen platform ya da varlık en geç bu sürede fark edilir. */
export const SOURCES_REFRESH_MS = 30_000;

/**
 * Fiyat akışlarını düzenli aralıkla okur. Bir tur bitmeden yenisi başlamaz; yavaş bir platform
 * turları üst üste bindirip bağlantı biriktiremez.
 */
@Injectable()
export class PriceIngestWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PriceIngestWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;
  private sources: PriceFeedSource[] = [];
  private sourcesLoadedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly ingest: PriceIngestService,
    @Inject(PRICE_FEED_DIRECTORY) private readonly directory: PriceFeedDirectory,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.WORKERS_ENABLED) {
      this.logger.log('Workers disabled in this process (WORKERS_ENABLED=false)');
      return;
    }
    this.stopped = false;
    this.schedule(0);
    this.logger.log(`Price ingest started, every ${this.env.PRICE_POLL_INTERVAL_MS} ms`);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Tek tur: gerekirse kaynak listesini yeniler, bütün platformları paralel okur. */
  async runOnce(): Promise<void> {
    if (this.clock() - this.sourcesLoadedAt >= SOURCES_REFRESH_MS) {
      try {
        this.sources = await this.directory.listSources();
        this.sourcesLoadedAt = this.clock();
      } catch (err) {
        this.logger.warn(
          `Could not load price feed sources: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }
    await Promise.allSettled(this.sources.map((source) => this.ingest.ingest(source)));
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((err: unknown) =>
          this.logger.error(`Price ingest round failed: ${err instanceof Error ? err.message : 'unknown'}`),
        )
        .finally(() => {
          if (!this.stopped) this.schedule(this.env.PRICE_POLL_INTERVAL_MS);
        });
    }, delayMs);
  }
}
