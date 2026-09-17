import { z } from 'zod';
import { type PublicBranding } from './branding';

/** Platformun imzaladığı oyuncu token'ının `aud` değeri. Başka bir hizmet için üretilmiş token kabul edilmez. */
export const PLAYER_TOKEN_AUDIENCE = 'lig';

/** Kabul edilen tek imza algoritması. `none` ve HS256 gibi algoritmalar reddedilir (T1). */
export const PLAYER_TOKEN_ALGORITHM = 'RS256';

/** Oturum çerezinin adı. Çerez HttpOnly, Secure ve SameSite=Strict'tir. */
export const SESSION_COOKIE_NAME = 'lig_session';

/** Platformdaki kullanıcının takma kimliği. Kişisel veri (ad, e-posta, TC) taşımamalıdır (NFR-04). */
export const externalPlayerId = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/, 'Geçersiz oyuncu kimliği');

/** Sıralamada görünen ad. Kontrol karakteri ve HTML açısı içeremez. */
export const displayName = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[^\p{Cc}<>]+$/u, 'Görünen ad geçersiz karakter içeriyor');

/** POST /auth/session gövdesi (FR-01). */
export const createSessionRequest = z.object({
  token: z.string().min(20).max(4096),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequest>;

/** İmzası doğrulandıktan sonra token içeriğinin taşıması gereken alanlar. */
export const playerTokenClaims = z.object({
  iss: z.string().min(1).max(256),
  sub: externalPlayerId,
  name: displayName.optional(),
  jti: z.string().min(16).max(128),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type PlayerTokenClaims = z.infer<typeof playerTokenClaims>;

export interface PublicPlayer {
  id: string;
  displayName: string;
  /** Görevler ve lig ödülleriyle kazanılan toplam XP (FR-07, FR-32). */
  xp: number;
}

export interface PublicPlatform {
  name: string;
  /** Marka ayarları (FR-22): oyuncu ekranının rengi ve logosu. */
  branding: PublicBranding;
  /** "Gerçek hesabıma geç" (FR-08). Tanımlı değilse buton gösterilmez. */
  realTradeUrl: string | null;
}

export interface MeResponse {
  player: PublicPlayer;
  platform: PublicPlatform;
}
