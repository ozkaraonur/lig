/**
 * Anahtar değişimi (K-015). Önce yeni anahtarı SECRET_KEYS'in başına ekle, eskisini arkada bırak;
 * API'yi yeni ayarla başlat; sonra bunu çalıştır. Bittiğinde eski anahtar SECRET_KEYS'ten çıkarılabilir.
 *
 * Kullanım: npm run secrets:rotate
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadEnv } from '../config/env';
import * as schema from '../db/schema';
import { rotateStoredSecrets } from './rotate-secrets';
import { createSecretCipher } from './secrets.module';

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const db = drizzle({ client: pool, schema, casing: 'snake_case' });
    const result = await rotateStoredSecrets(db, createSecretCipher(env));
    console.warn(
      `Yeniden şifrelendi: ${result.tenantWebhookSecrets} webhook anahtarı, ${result.adminMfaSecrets} MFA secret'ı.`,
    );
    if (result.unreadable.length > 0) {
      console.error(
        `Çözülemeyen ${result.unreadable.length} kayıt var: ${result.unreadable.join(', ')}\n` +
          'SECRET_KEYS içinde bu kayıtları yazan eski anahtar yok. O anahtarı geri ekleyip tekrar çalıştır; ' +
          'eski anahtarı bu uyarı kaybolmadan silme.',
      );
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
