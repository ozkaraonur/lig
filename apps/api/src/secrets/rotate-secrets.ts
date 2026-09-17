import { and, eq, isNotNull } from 'drizzle-orm';
import { type Database } from '../db/db.module';
import { adminUsers, tenants } from '../db/schema';
import { type SecretCipher, secretContext } from './secret-cipher';

export interface RotationResult {
  tenantWebhookSecrets: number;
  adminMfaSecrets: number;
  /**
   * Elimizdeki anahtarlarla çözülemeyen kayıtlar (`tenants:<id>`, `admin_users:<id>`). Bunlara dokunulmaz.
   * Boş değilse SECRET_KEYS'ten gereken eski bir anahtar çıkarılmış demektir; o anahtar geri eklenmeden
   * eski anahtar silinmemeli.
   */
  unreadable: string[];
}

export interface RotationOptions {
  /** Yalnızca bu tenant'ın kayıtları. Verilmezse bütün veritabanı. */
  tenantId?: string;
}

/**
 * Etkin anahtarla yazılmamış şifreli değerleri yeniden şifreler (K-015). Tekrar çalıştırmak güvenlidir.
 * Çözülemeyen bir kayıt işi durdurmaz: raporlanır, diğerleri yine yeniden şifrelenir.
 * Satır okunduktan sonra değişmişse (ör. yönetici tam o anda MFA'yı yeniden kurduysa) güncelleme atlanır;
 * yeni değer zaten etkin anahtarla yazılmıştır.
 */
export async function rotateStoredSecrets(
  db: Database,
  cipher: SecretCipher,
  options: RotationOptions = {},
): Promise<RotationResult> {
  const result: RotationResult = { tenantWebhookSecrets: 0, adminMfaSecrets: 0, unreadable: [] };

  const reencrypt = async (label: string, ciphertext: string, context: string): Promise<string | null> => {
    try {
      return await cipher.encrypt(await cipher.decrypt(ciphertext, context), context);
    } catch {
      result.unreadable.push(label);
      return null;
    }
  };

  const tenantRows = await db
    .select({ id: tenants.id, ciphertext: tenants.webhookSecretCiphertext })
    .from(tenants)
    .where(
      and(
        isNotNull(tenants.webhookSecretCiphertext),
        options.tenantId ? eq(tenants.id, options.tenantId) : undefined,
      ),
    );
  for (const row of tenantRows) {
    if (!row.ciphertext || cipher.isCurrent(row.ciphertext)) continue;
    const next = await reencrypt(
      `tenants:${row.id}`,
      row.ciphertext,
      secretContext.tenantWebhookSecret(row.id),
    );
    if (!next) continue;
    const updated = await db
      .update(tenants)
      .set({ webhookSecretCiphertext: next })
      .where(and(eq(tenants.id, row.id), eq(tenants.webhookSecretCiphertext, row.ciphertext)))
      .returning({ id: tenants.id });
    result.tenantWebhookSecrets += updated.length;
  }

  const adminRows = await db
    .select({ id: adminUsers.id, ciphertext: adminUsers.mfaSecretCiphertext })
    .from(adminUsers)
    .where(
      and(
        isNotNull(adminUsers.mfaSecretCiphertext),
        options.tenantId ? eq(adminUsers.tenantId, options.tenantId) : undefined,
      ),
    );
  for (const row of adminRows) {
    if (!row.ciphertext || cipher.isCurrent(row.ciphertext)) continue;
    const next = await reencrypt(
      `admin_users:${row.id}`,
      row.ciphertext,
      secretContext.adminMfaSecret(row.id),
    );
    if (!next) continue;
    const updated = await db
      .update(adminUsers)
      .set({ mfaSecretCiphertext: next })
      .where(and(eq(adminUsers.id, row.id), eq(adminUsers.mfaSecretCiphertext, row.ciphertext)))
      .returning({ id: adminUsers.id });
    result.adminMfaSecrets += updated.length;
  }

  return result;
}
