import { z } from 'zod';
import { type AssetClass, type LeagueStatus, type LeagueType, MAX_PRICE_AGE_MS } from './domain';

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

/** Oyuncu yalnızca yayındaki ve bitmemiş bir lige katılabilir (FR-03). Başlamamış lige önceden katılmak serbesttir. */
export function canJoinLeague(
  league: { status: LeagueStatus; startsAt: Date; endsAt: Date },
  now: Date,
): boolean {
  return league.status === 'active' && leaguePhase(league, now) !== 'ended';
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
}

export interface LeagueAssetPrice {
  assetId: string;
  symbol: string;
  price: string | null;
  /** Fiyatın platformda oluştuğu an, milisaniye. Fiyat hiç gelmediyse null. */
  priceAt: number | null;
  stale: boolean;
}

export interface LeagueAsset extends LeagueAssetPrice {
  name: string;
  assetClass: AssetClass;
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
