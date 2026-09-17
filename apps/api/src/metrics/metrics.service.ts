import { Inject, Injectable } from '@nestjs/common';
import { type MetricRangeDays, type MetricsResponse } from '@lig/shared';
import { type AdminAccount } from '../admin-auth/ports';
import { CLOCK_MS, type MsClock } from '../common/clock';
import {
  METRICS_REPOSITORY,
  type MetricsRepository,
  REAL_TRADE_CLICK_REPOSITORY,
  type RealTradeClickRepository,
} from './ports';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MetricsService {
  constructor(
    @Inject(METRICS_REPOSITORY) private readonly metrics: MetricsRepository,
    @Inject(REAL_TRADE_CLICK_REPOSITORY) private readonly clicks: RealTradeClickRepository,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  /** FR-23. Denetim kaydına girmez: okuma, değişiklik değil. */
  async report(admin: AdminAccount, days: MetricRangeDays): Promise<MetricsResponse> {
    const now = new Date(this.clock());
    const since = new Date(now.getTime() - days * DAY_MS);
    const snapshot = await this.metrics.snapshot(admin.tenantId, since, now);
    return {
      days,
      since: since.toISOString(),
      generatedAt: now.toISOString(),
      ...snapshot,
    };
  }

  /** Oyuncu "Gerçek hesabıma geç"e dokundu. Sayım için; oyuncuya bir şey döndürmez. */
  async recordClick(tenantId: string, playerId: string, leagueId: string | null): Promise<void> {
    await this.clicks.record({ tenantId, playerId, leagueId });
  }
}
