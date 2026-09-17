import { z } from 'zod';
import { type AdminRole } from './domain';

/** Yönetici oturum çerezi. Oyuncu çerezinden ayrı; yalnızca `/admin` altındaki API yollarına gider. */
export const ADMIN_SESSION_COOKIE_NAME = 'lig_admin_session';
/** Parola doğru girildikten sonra, MFA adımı bitene kadar geçerli kısa ömürlü çerez. */
export const ADMIN_PREAUTH_COOKIE_NAME = 'lig_admin_preauth';

/** NIST SP 800-63B: bileşim kuralı yok, uzunluk var. Üst sınır, argon2'ye dev girdiyle yük bindirilmesini önler. */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_LENGTH = 128;

export const adminEmail = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email('Geçerli bir e-posta adresi gir'))
  .transform((v) => v.toLowerCase());

/** Yeni parola belirlenirken uygulanan kural. */
export const adminPassword = z
  .string()
  .min(ADMIN_PASSWORD_MIN_LENGTH, `Parola en az ${ADMIN_PASSWORD_MIN_LENGTH} karakter olmalı`)
  .max(ADMIN_PASSWORD_MAX_LENGTH, `Parola en fazla ${ADMIN_PASSWORD_MAX_LENGTH} karakter olabilir`);

/**
 * POST /admin/auth/login. Girişte uzunluk kuralı uygulanmaz: kural sonradan değişirse eski parolalar
 * "geçersiz alan" yerine normal akışla doğrulanır. Yalnızca aşırı uzun girdi kesilir.
 */
export const adminLoginRequest = z.strictObject({
  email: adminEmail,
  password: z.string().min(1).max(ADMIN_PASSWORD_MAX_LENGTH),
});
export type AdminLoginRequest = z.infer<typeof adminLoginRequest>;

export const mfaCode = z.string().regex(/^\d{6}$/, 'Kod 6 haneli olmalı');

/** POST /admin/auth/mfa/verify */
export const adminMfaVerifyRequest = z.strictObject({ code: mfaCode });
export type AdminMfaVerifyRequest = z.infer<typeof adminMfaVerifyRequest>;

/** Parola doğruysa bir sonraki adım: MFA hiç kurulmadıysa kurulum, kuruluysa kod girişi. */
export interface AdminLoginResponse {
  next: 'mfa_setup' | 'mfa_verify';
}

export interface AdminMfaSetupResponse {
  /** Doğrulama uygulamasının okuduğu adres (QR kod içeriği). */
  otpauthUri: string;
  /** QR okutulamazsa elle girilecek anahtar (base32). */
  secret: string;
}

export interface AdminProfile {
  id: string;
  email: string;
  role: AdminRole;
}

export interface AdminMeResponse {
  admin: AdminProfile;
  tenant: { name: string };
}
