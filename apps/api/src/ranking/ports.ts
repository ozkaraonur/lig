import { type MemberHolding, type Standing, type XpGrant } from './standings';

export interface RankableLeague {
  id: string;
  tenantId: string;
}

export interface RankingSource {
  /** Şu an işlemde olan ligler: yayında, başlamış, bitmemiş. Biten ligin sıralaması artık hesaplanmaz. */
  listRunningLeagues(now: Date): Promise<RankableLeague[]>;
  /** Süresi dolmuş ama henüz kapatılmamış ligler (FR-32). */
  listLeaguesDueForClose(now: Date): Promise<RankableLeague[]>;
  loadHoldings(leagueId: string): Promise<MemberHolding[]>;
  displayNames(playerIds: string[]): Promise<Map<string, string>>;
}

export interface StoredRankEntry {
  playerId: string;
  valueUnits: bigint;
  rank: number;
}

/** Süren liglerin anlık sıralaması (Redis sorted set). */
export interface RankingStore {
  replace(leagueId: string, standings: Standing[], updatedAtMs: number): Promise<void>;
  top(leagueId: string, limit: number): Promise<StoredRankEntry[]>;
  entryFor(leagueId: string, playerId: string): Promise<StoredRankEntry | null>;
  count(leagueId: string): Promise<number>;
  updatedAt(leagueId: string): Promise<number | null>;
  remove(leagueId: string): Promise<void>;
}

export interface FinalStandingRow {
  playerId: string;
  displayName: string;
  finalRank: number;
  finalValue: string;
}

/** Kapanmış liglerin dondurulmuş sonuçları (PostgreSQL). */
export interface FinalStandingsReader {
  top(leagueId: string, limit: number): Promise<FinalStandingRow[]>;
  entryFor(leagueId: string, playerId: string): Promise<FinalStandingRow | null>;
  count(leagueId: string): Promise<number>;
  xpAwarded(leagueId: string, playerId: string): Promise<number>;
}

export interface ClosingLeague {
  id: string;
  tenantId: string;
  status: string;
  endsAt: Date;
}

export interface LeagueCloseTransaction {
  /** Ligi özel kilitle okur: kapanış sürerken emir işlenemez (emirler lige paylaşımlı kilit alır). */
  lockLeague(leagueId: string): Promise<ClosingLeague | null>;
  loadHoldings(leagueId: string): Promise<MemberHolding[]>;
  membershipsWithOrders(leagueId: string): Promise<Set<string>>;
  saveFinalStandings(standings: Standing[]): Promise<void>;
  /** Daha önce verilmiş (aynı oyuncu, sebep, kaynak) ödülü atlar. Gerçekten verilen XP toplamını döner. */
  grantXp(grants: XpGrant[]): Promise<number>;
  markClosed(leagueId: string, closedAt: Date, closingPrices: Record<string, string | null>): Promise<void>;
}

export interface LeagueCloseUnitOfWork {
  run<T>(work: (tx: LeagueCloseTransaction) => Promise<T>): Promise<T>;
}

export const RANKING_SOURCE = Symbol('RANKING_SOURCE');
export const RANKING_STORE = Symbol('RANKING_STORE');
export const FINAL_STANDINGS_READER = Symbol('FINAL_STANDINGS_READER');
export const LEAGUE_CLOSE_UOW = Symbol('LEAGUE_CLOSE_UOW');
