/**
 * Veritabanında şifreli saklanan gizli değerlerin (webhook anahtarı, MFA secret'ı) şifreleme arayüzü (K-015).
 *
 * `context` şifreli metni tek bir satır ve kolona bağlar (AES-GCM ek doğrulama verisi). Veritabanına yazma
 * yetkisi olan biri A tenant'ının şifreli anahtarını B tenant'ının satırına kopyalarsa çözme başarısız olur.
 *
 * Bugün tek uygulama yerel anahtarla çalışan `LocalSecretCipher`. Pilot ortamında OpenBao Transit adaptörü
 * aynı arayüzü uygular; çağıran kod değişmez.
 */
export interface SecretCipher {
  encrypt(plaintext: string, context: string): Promise<string>;
  /** Anahtar yanlışsa, metin bozulmuşsa ya da bağlam uyuşmuyorsa `SecretDecryptionError` fırlatır. */
  decrypt(ciphertext: string, context: string): Promise<string>;
  /** Şifreli metin etkin anahtarla mı yazılmış? Anahtar değişiminde (rotation) yeniden şifrelenecekleri bulur. */
  isCurrent(ciphertext: string): boolean;
}

export class SecretDecryptionError extends Error {
  constructor() {
    // Ayrıntı (hangi anahtar, hangi adım) bilerek yazılmaz.
    super('Secret could not be decrypted');
    this.name = 'SecretDecryptionError';
  }
}

export const SECRET_CIPHER = Symbol('SECRET_CIPHER');

/** Bağlam metinleri tek yerde üretilir; yazan ve okuyan aynı değeri kullanmak zorunda. */
export const secretContext = {
  tenantWebhookSecret: (tenantId: string) => `tenants.webhook_secret:${tenantId}`,
  adminMfaSecret: (adminUserId: string) => `admin_users.mfa_secret:${adminUserId}`,
};
