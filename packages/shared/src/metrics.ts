import { z } from 'zod';
import { type LeagueStatus } from './domain';

/**
 * Yönetici metrikleri (FR-23). Soru şu: lig modülü platformda gerçek işlemi artırıyor mu?
 * Sayılar canlı sorgulanır, özet tablosu tutulmaz (K-025).
 */
export const METRIC_RANGE_DAYS = [7, 30, 90] as const;
export type MetricRangeDays = (typeof METRIC_RANGE_DAYS)[number];
export const DEFAULT_METRIC_RANGE: MetricRangeDays = 30;

export const metricsQuery = z.strictObject({
  days: z.coerce
    .number()
    .int()
    .refine((v): v is MetricRangeDays => (METRIC_RANGE_DAYS as readonly number[]).includes(v), {
      message: `Dönem ${METRIC_RANGE_DAYS.join(', ')} günden biri olmalı`,
    })
    .default(DEFAULT_METRIC_RANGE),
});
export type MetricsQuery = z.infer<typeof metricsQuery>;

/** POST /real-trade/click gövdesi: tıklama lig ekranından geldiyse lig kimliği. */
export const realTradeClickRequest = z.strictObject({ leagueId: z.uuid().nullish() });
export type RealTradeClickRequest = z.infer<typeof realTradeClickRequest>;

export interface MetricsTotals {
  /** Platformda lig modülünü en az bir kez açmış oyuncu (dönemden bağımsız). */
  players: number;
  /** Dönemde lige katılan ya da emir veren oyuncu. */
  activePlayers: number;
  joins: number;
  orders: number;
  questsCompleted: number;
  xpGranted: number;
  /** "Gerçek hesabıma geç" tıklaması: toplam ve farklı oyuncu. */
  realTradeClicks: number;
  realTradeClickPlayers: number;
  /** Platformun webhook ile bildirdiği gerçek işlem olayı (FR-31). */
  realTrades: number;
  accountsOpened: number;
}

/**
 * Gerçek işlem yapan kullanıcıların lig modülüyle ilişkisi (FR-23 karşılaştırması).
 * Sayılar dönemdeki farklı kullanıcı sayısıdır.
 */
export interface RealTradeBreakdown {
  /** Bir lige katılmış oyuncular. */
  leaguePlayers: number;
  /** Modülü açmış ama hiç lige katılmamış oyuncular. */
  modulePlayers: number;
  /** Lig modülünü hiç açmamış platform kullanıcıları. */
  outsiders: number;
}

export interface LeagueMetricRow {
  id: string;
  name: string;
  status: LeagueStatus;
  members: number;
  orders: number;
  /** Bu ligin ekranından yapılan "gerçek hesabıma geç" tıklaması. */
  realTradeClicks: number;
}

export interface MetricsResponse {
  days: MetricRangeDays;
  /** Dönem başlangıcı; sayılar bu andan sonrasını kapsar. */
  since: string;
  generatedAt: string;
  totals: MetricsTotals;
  realTradeBreakdown: RealTradeBreakdown;
  leagues: LeagueMetricRow[];
}

/** Oran: payda sıfırsa null döner, ekranda "-" gösterilir. Yüzde değil, 0-1 arası. */
export function ratio(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return part / whole;
}

export function formatRatio(value: number | null): string {
  if (value === null) return '-';
  return `%${(value * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`;
}
