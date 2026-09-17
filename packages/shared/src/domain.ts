/** Değerler veritabanındaki enum'larla birebir aynıdır (apps/api/src/db/schema.ts). */

export const LEAGUE_TYPES = ['weekly', 'season', 'friends'] as const;
export type LeagueType = (typeof LEAGUE_TYPES)[number];

export const LEAGUE_STATUSES = ['draft', 'active', 'finished'] as const;
export type LeagueStatus = (typeof LEAGUE_STATUSES)[number];

export const ORDER_SIDES = ['buy', 'sell'] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

export const ASSET_CLASSES = ['crypto', 'equity'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const ADMIN_ROLES = ['owner', 'editor', 'viewer'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** XP kazanma sebepleri. Aynı sebep ve kaynak için bir oyuncuya bir kez XP verilir. */
export const XP_REASONS = ['league_rank', 'league_participation', 'quest'] as const;
export type XpReason = (typeof XP_REASONS)[number];

export const PLATFORM_EVENT_TYPES = ['real_trade', 'account_opened'] as const;
export type PlatformEventType = (typeof PLATFORM_EVENT_TYPES)[number];

/** Emir motorunun kabul ettiği en eski fiyat yaşı (FR-04, activity diyagramı). */
export const MAX_PRICE_AGE_MS = 5_000;

/** Platformun imzaladığı giriş token'ının kabul edilen en uzun ömrü (NFR-03). */
export const MAX_PLAYER_TOKEN_TTL_SECONDS = 300;
