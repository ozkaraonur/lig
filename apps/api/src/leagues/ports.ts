import { type AssetClass, type LeagueStatus, type LeagueType } from '@lig/shared';

export interface LeagueRecord {
  id: string;
  tenantId: string;
  name: string;
  type: LeagueType;
  status: LeagueStatus;
  startsAt: Date;
  endsAt: Date;
  startingCash: string;
  assetIds: string[];
  /** Kapanmış ligde değerleme fiyatları (FR-32); süren ligde null. */
  closingPrices: Record<string, string | null> | null;
  maxMembers: number | null;
  lateJoinAllowed: boolean;
  memberCount: number;
  /** Soran oyuncu bu ligin üyesi mi. */
  joined: boolean;
}

export interface AssetRecord {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
}

export interface MembershipRecord {
  id: string;
  leagueId: string;
  playerId: string;
  cash: string;
  joinedAt: Date;
}

export interface LeagueRepository {
  /**
   * Oyuncunun görebileceği ligler: kendi platformunun, yayındaki ya da yakın zamanda kapanmış,
   * arkadaş ligi olmayan ligler. Taslaklar ve başka platformların ligleri asla dönmez (T4).
   */
  listVisible(tenantId: string, playerId: string, now: Date): Promise<LeagueRecord[]>;
  findVisible(tenantId: string, leagueId: string, playerId: string): Promise<LeagueRecord | null>;
  /** Varlıklar tenant ile sınırlanır; lig kaydı bozuk olsa bile başka platformun varlığı dönmez. */
  findAssets(tenantId: string, assetIds: string[]): Promise<AssetRecord[]>;
  findMembership(leagueId: string, playerId: string): Promise<MembershipRecord | null>;
  /**
   * Katılma koşullarını ve kaydı tek SQL cümlesinde yapar: lig bu tenant'ın, yayında ve bitmemiş olmalı,
   * oyuncu aynı tenant'ın olmalı, kontenjan dolmamış ve (lig başladıysa) geç katılım açık olmalı (FR-20).
   * Koşul tutmazsa ya da oyuncu zaten üyeyse `null` döner.
   */
  createMembership(
    tenantId: string,
    leagueId: string,
    playerId: string,
    now: Date,
  ): Promise<MembershipRecord | null>;
}

export const LEAGUE_REPOSITORY = Symbol('LEAGUE_REPOSITORY');

/** Oyuncuya gösterilen, kapanmış liglerin geriye dönük süresi. */
export const FINISHED_LEAGUE_VISIBILITY_DAYS = 30;

export const MAX_LISTED_LEAGUES = 50;
