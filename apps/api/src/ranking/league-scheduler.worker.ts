import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { ENV, type Env } from '../config/env';
import { LeagueCloseService } from './league-close.service';
import { RANKING_SOURCE, type RankingSource } from './ports';
import { RankingService } from './ranking.service';

/**
 * Lig zamanlayıcısı: süren liglerin sıralamasını düzenli aralıkla yeniler (FR-06, NFR-01: 2 sn içinde)
 * ve süresi dolan ligleri kapatır (FR-32). Bir tur bitmeden yenisi başlamaz.
 */
@Injectable()
export class LeagueSchedulerWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LeagueSchedulerWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;

  constructor(
    private readonly ranking: RankingService,
    private readonly closer: LeagueCloseService,
    @Inject(RANKING_SOURCE) private readonly source: RankingSource,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.WORKERS_ENABLED) return;
    this.stopped = false;
    this.schedule(0);
    this.logger.log(`League scheduler started, every ${this.env.RANKING_INTERVAL_MS} ms`);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  async runOnce(): Promise<void> {
    const now = new Date(this.clock());
    const [due, running] = await Promise.all([
      this.source.listLeaguesDueForClose(now),
      this.source.listRunningLeagues(now),
    ]);

    for (const league of due) {
      await this.closer.close(league.id).catch((err: unknown) => this.fail('close', league.id, err));
    }
    // Ligler sırayla hesaplanır: bir pilotta birkaç lig var, veritabanını paralel sorgularla boğmaya gerek yok.
    for (const league of running) {
      await this.ranking.recompute(league).catch((err: unknown) => this.fail('ranking', league.id, err));
    }
  }

  private fail(job: string, leagueId: string, err: unknown): void {
    this.logger.error(
      `League ${job} failed for ${leagueId}: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((err: unknown) =>
          this.logger.error(
            `League scheduler round failed: ${err instanceof Error ? err.message : 'unknown'}`,
          ),
        )
        .finally(() => {
          if (!this.stopped) this.schedule(this.env.RANKING_INTERVAL_MS);
        });
    }, delayMs);
  }
}
