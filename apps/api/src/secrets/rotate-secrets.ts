import { and, eq, isNotNull } from 'drizzle-orm';
import { type Database } from '../db/db.module';
import { adminUsers, tenants } from '../db/schema';
import { type SecretCipher, secretContext } from './secret-cipher';

export interface RotationResult {
  tenantWebhookSecrets: number;
  adminMfaSecrets: number;
}

/**
 * Etkin anahtarla yazılmamış bütün şifreli değerleri yeniden şifreler (K-015). Tekrar çalıştırmak güvenlidir.
 * Satır okunduktan sonra değişmişse (ör. yönetici tam o anda MFA'yı yeniden kurduysa) güncelleme atlanır;
 * yeni değer zaten etkin anahtarla yazılmıştır.
 */
export async function rotateStoredSecrets(db: Database, cipher: SecretCipher): Promise<RotationResult> {
  const result: RotationResult = { tenantWebhookSecrets: 0, adminMfaSecrets: 0 };

  const tenantRows = await db
    .select({ id: tenants.id, ciphertext: tenants.webhookSecretCiphertext })
    .from(tenants)
    .where(isNotNull(tenants.webhookSecretCiphertext));
  for (const row of tenantRows) {
    if (!row.ciphertext || cipher.isCurrent(row.ciphertext)) continue;
    const context = secretContext.tenantWebhookSecret(row.id);
    const next = await cipher.encrypt(await cipher.decrypt(row.ciphertext, context), context);
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
    .where(isNotNull(adminUsers.mfaSecretCiphertext));
  for (const row of adminRows) {
    if (!row.ciphertext || cipher.isCurrent(row.ciphertext)) continue;
    const context = secretContext.adminMfaSecret(row.id);
    const next = await cipher.encrypt(await cipher.decrypt(row.ciphertext, context), context);
    const updated = await db
      .update(adminUsers)
      .set({ mfaSecretCiphertext: next })
      .where(and(eq(adminUsers.id, row.id), eq(adminUsers.mfaSecretCiphertext, row.ciphertext)))
      .returning({ id: adminUsers.id });
    result.adminMfaSecrets += updated.length;
  }

  return result;
}
