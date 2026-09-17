import { type LeagueMetricRow, type MetricsTotals, type RealTradeBreakdown } from '@lig/shared';

export interface MetricsSnapshot {
  totals: MetricsTotals;
  realTradeBreakdown: RealTradeBreakdown;
  leagues: LeagueMetricRow[];
}

export interface MetricsRepository {
  /** `since` ile `now` arası; toplamların bir kısmı (ör. toplam oyuncu) dönemden bağımsızdır. */
  snapshot(tenantId: string, since: Date, now: Date): Promise<MetricsSnapshot>;
}

export interface RealTradeClick {
  tenantId: string;
  playerId: string;
  /** Tıklama lig ekranından geldiyse lig kimliği; ana ekrandan geldiyse null. */
  leagueId: string | null;
}

export interface RealTradeClickRepository {
  /** Lig kimliği verilmişse oyuncunun o lige üye olduğu doğrulanır; değilse tıklama ligsiz kaydedilir. */
  record(click: RealTradeClick): Promise<void>;
}

export const METRICS_REPOSITORY = Symbol('METRICS_REPOSITORY');
export const REAL_TRADE_CLICK_REPOSITORY = Symbol('REAL_TRADE_CLICK_REPOSITORY');
