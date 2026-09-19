import { z } from 'zod';
import { type AssetClass, type LeagueStatus, type LeagueType, MAX_PRICE_AGE_MS } from './domain';
import { type MarketStatus } from './market';

/**
 * Oyuncunun gördüğü lig evresi. Veritabanındaki `status` yöneticinin kararıdır (taslak, yayında, kapandı);
 * evre ise yayındaki bir ligin tarihlerine göre hesaplanır.
 */
export const LEAGUE_PHASES = ['upcoming', 'running', 'ended'] as const;
export type LeaguePhase = (typeof LEAGUE_PHASES)[number];

export function leaguePhase(
  league: { status: LeagueStatus; startsAt: Date; endsAt: Date },
  now: Date,
): LeaguePhase {
  if (league.status === 'finished' || now >= league.endsAt) return 'ended';
  if (now < league.startsAt) return 'upcoming';
  return 'running';
}

/**
 * Oyuncu yalnızca yayındaki ve bitmemiş bir lige katılabilir (FR-03). Başlamamış lige önceden katılmak serbesttir.
 * Katılım koşulları (FR-20): kontenjan dolmamış olmalı; lig başladıysa geç katılıma izin verilmiş olmalı.
 */
export function canJoinLeague(
  league: {
    status: LeagueStatus;
    startsAt: Date;
    endsAt: Date;
    maxMembers?: number | null;
    lateJoinAllowed?: boolean;
    memberCount?: number;
  },
  now: Date,
): boolean {
  if (league.status !== 'active') return false;
  const phase = leaguePhase(league, now);
  if (phase === 'ended') return false;
  if (phase === 'running' && league.lateJoinAllowed === false) return false;
  if (
    league.maxMembers !== undefined &&
    league.maxMembers !== null &&
    (league.memberCount ?? 0) >= league.maxMembers
  ) {
    return false;
  }
  return true;
}

/** Fiyat, alındığı andan bu yana MAX_PRICE_AGE_MS'den eskiyse bayat sayılır; bayat fiyattan emir verilmez (T2). */
export function isPriceStale(priceTimestampMs: number, nowMs: number): boolean {
  return nowMs - priceTimestampMs > MAX_PRICE_AGE_MS;
}

export const leagueIdParam = z.uuid();

export interface LeagueSummary {
  id: string;
  name: string;
  type: LeagueType;
  phase: LeaguePhase;
  startsAt: string;
  endsAt: string;
  /** Sanal TL, string: JavaScript number'ı para için güvenli değildir. */
  startingCash: string;
  memberCount: number;
  joined: boolean;
  /** Lig kapanışı yapıldı: sıralama dondu, ödüller dağıtıldı (FR-32). */
  closed: boolean;
  /** Kontenjan (FR-20). Sınırsızsa null. */
  maxMembers: number | null;
  lateJoinAllowed: boolean;
}

export interface LeagueAssetPrice {
  assetId: string;
  symbol: string;
  price: string | null;
  /** Fiyatın platformda oluştuğu an, milisaniye. Fiyat hiç gelmediyse null. */
  priceAt: number | null;
  stale: boolean;
}

/** GET /leagues/:id/prices yanıtı. Ligde hisse varlığı yoksa `market` null. */
export interface LeaguePricesResponse {
  prices: LeagueAssetPrice[];
  market: MarketStatus | null;
}

export interface LeagueAsset extends LeagueAssetPrice {
  name: string;
  assetClass: AssetClass;
  /** Hisse varlıklarında sektör; kripto varlıklarda null. */
  sector: string | null;
}

export interface LeagueMembership {
  cash: string;
  joinedAt: string;
}

export interface LeagueDetail extends LeagueSummary {
  canJoin: boolean;
  assets: LeagueAsset[];
  membership: LeagueMembership | null;
}

export interface JoinLeagueResponse {
  created: boolean;
  membership: LeagueMembership;
}
