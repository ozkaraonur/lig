import { type AdminRole } from '@lig/shared';

export interface AdminAccount {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  role: AdminRole;
  mfaSecretCiphertext: string | null;
  mfaLastUsedStep: number | null;
}

export interface AdminRepository {
  findByEmail(email: string): Promise<AdminAccount | null>;
  findById(adminId: string): Promise<AdminAccount | null>;
  tenantName(tenantId: string): Promise<string | null>;
  updatePasswordHash(adminId: string, passwordHash: string): Promise<void>;
  /**
   * MFA'yı ilk kez etkinleştirir ve kurulumda kullanılan kodun adımını harcanmış sayar.
   * MFA zaten etkinse (ör. iki sekmede aynı anda kurulum) hiçbir şey yazmaz ve `false` döner.
   */
  enableMfa(adminId: string, secretCiphertext: string, usedStep: number, at: Date): Promise<boolean>;
  /**
   * Kodun zaman adımını harcar. Tek koşullu UPDATE: aynı kod paralel iki istekle gönderilse de
   * yalnızca biri `true` alır.
   */
  consumeMfaStep(adminId: string, step: number): Promise<boolean>;
  recordLogin(adminId: string, at: Date): Promise<void>;
}

export interface AdminSessionData {
  adminId: string;
  tenantId: string;
  createdAtMs: number;
}

/** Parola doğrulandı, MFA adımı bekleniyor. */
export interface AdminPreAuthData {
  adminId: string;
  tenantId: string;
  mfaEnrolled: boolean;
  /** Kurulum sırasında üretilen, henüz onaylanmamış TOTP secret'ı (şifreli). */
  pendingSecretCiphertext: string | null;
  createdAtMs: number;
}

/** Rastgele token'la açılan, Redis'te token özetiyle saklanan kısa ömürlü kayıtlar. */
export interface TokenStore<T> {
  create(data: T, ttlSeconds: number): Promise<string>;
  get(token: string): Promise<T | null>;
  /** Veriyi değiştirir, kalan süreye dokunmaz. Kayıt yoksa `false`. */
  replace(token: string, data: T): Promise<boolean>;
  /** Süreyi yeniden başlatır. */
  touch(token: string, ttlSeconds: number): Promise<void>;
  destroy(token: string): Promise<void>;
}

export const ADMIN_REPOSITORY = Symbol('ADMIN_REPOSITORY');
export const ADMIN_SESSION_STORE = Symbol('ADMIN_SESSION_STORE');
export const ADMIN_PREAUTH_STORE = Symbol('ADMIN_PREAUTH_STORE');
