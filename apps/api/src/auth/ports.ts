/**
 * Giriş modülünün dış dünyayla konuştuğu arayüzler. Gerçek uygulamada Redis ve PostgreSQL,
 * testlerde bellek içi sahteleri kullanılır.
 */

export interface TenantKey {
  tenantId: string;
  issuer: string;
  publicKeyPem: string;
}

export interface TenantDirectory {
  findByIssuer(issuer: string): Promise<TenantKey | null>;
}

export interface ReplayStore {
  /** Anahtar daha önce kullanılmadıysa işaretler ve `true` döner; kullanıldıysa `false`. */
  markUsed(key: string, ttlSeconds: number): Promise<boolean>;
}

export interface SessionData {
  playerId: string;
  tenantId: string;
  createdAt: number;
}

export interface SessionStore {
  /** Yeni oturum açar ve istemciye verilecek rastgele token'ı döner. Token'ın kendisi saklanmaz. */
  create(data: SessionData, ttlSeconds: number): Promise<string>;
  get(token: string): Promise<SessionData | null>;
  destroy(token: string): Promise<void>;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

export interface PlayerRecord {
  id: string;
  tenantId: string;
  displayName: string;
}

export interface PlayerRepository {
  upsert(tenantId: string, externalId: string, displayName: string): Promise<PlayerRecord>;
  findById(tenantId: string, playerId: string): Promise<PlayerRecord | null>;
}

export const TENANT_DIRECTORY = Symbol('TENANT_DIRECTORY');
export const REPLAY_STORE = Symbol('REPLAY_STORE');
export const SESSION_STORE = Symbol('SESSION_STORE');
export const RATE_LIMITER = Symbol('RATE_LIMITER');
export const PLAYER_REPOSITORY = Symbol('PLAYER_REPOSITORY');
export const CLOCK = Symbol('CLOCK');

/** Saniye cinsinden şimdiki zaman. Testlerde sabitlenebilsin diye enjekte edilir. */
export type Clock = () => number;
export const systemClock: Clock = () => Math.floor(Date.now() / 1000);
