/**
 * Yönetici hesabı işlemleri. Panelden yönetici davet etme Faz 2'nin 3. adımında gelir; o zamana kadar
 * ilk hesap buradan açılır.
 *
 *   npm run admin:create -- --issuer mock-platform --email ayse@platform.com --role owner
 *   npm run admin:reset-mfa -- --email ayse@platform.com
 *
 * Parola rastgele üretilir ve yalnızca bir kez ekrana yazılır. Komut satırında parola alınmaz:
 * shell geçmişine ve süreç listesine düşerdi.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { ADMIN_ROLES, type AdminRole, adminEmail } from '@lig/shared';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { recordAudit } from '../audit/audit-log';
import { loadEnv } from '../config/env';
import * as schema from '../db/schema';
import { hashPassword } from './password-hasher';

/** Komutun asıl çıktısı stdout'a; ipuçları stderr'e. */
const print = (line: string) => process.stdout.write(`${line}\n`);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: { issuer: { type: 'string' }, email: { type: 'string' }, role: { type: 'string' } },
  });
  const email = adminEmail.safeParse(values.email ?? '');
  if (!email.success) fail('--email geçerli bir e-posta olmalı.');

  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  try {
    if (command === 'create') {
      const role = (values.role ?? 'owner') as AdminRole;
      if (!ADMIN_ROLES.includes(role)) fail(`--role şunlardan biri olmalı: ${ADMIN_ROLES.join(', ')}`);
      if (!values.issuer) fail('--issuer gerekli (platformun SSO issuer değeri, ör. mock-platform).');
      const [tenant] = await db
        .select({ id: schema.tenants.id, name: schema.tenants.name })
        .from(schema.tenants)
        .where(eq(schema.tenants.ssoIssuer, values.issuer))
        .limit(1);
      if (!tenant) fail(`"${values.issuer}" issuer'lı platform bulunamadı.`);

      const password = randomBytes(18).toString('base64url');
      const passwordHash = await hashPassword(password);
      const inserted = await db.transaction(async (tx) => {
        const rows = await tx
          .insert(schema.adminUsers)
          .values({ tenantId: tenant.id, email: email.data, role, passwordHash })
          .onConflictDoNothing({ target: schema.adminUsers.email })
          .returning({ id: schema.adminUsers.id });
        const [created] = rows;
        if (created) {
          await recordAudit(tx, {
            tenantId: tenant.id,
            action: 'admin.created',
            actor: { type: 'cli' },
            target: { type: 'admin', id: created.id, label: email.data },
            metadata: { role },
            occurredAt: new Date(),
          });
        }
        return rows;
      });
      if (inserted.length === 0) fail('Bu e-postayla bir yönetici zaten var.');
      print(`Yönetici açıldı: ${email.data} (${role}), platform: ${tenant.name}`);
      print(`Geçici parola (bir kez gösterilir): ${password}`);
      print('İlk girişte doğrulama uygulamasıyla MFA kurulumu istenecek.');
      return;
    }

    if (command === 'reset-mfa') {
      const updated = await db.transaction(async (tx) => {
        const rows = await tx
          .update(schema.adminUsers)
          .set({
            mfaSecretCiphertext: null,
            mfaEnabledAt: null,
            mfaLastUsedStep: null,
            sessionVersion: sql`${schema.adminUsers.sessionVersion} + 1`,
          })
          .where(eq(schema.adminUsers.email, email.data))
          .returning({ id: schema.adminUsers.id, tenantId: schema.adminUsers.tenantId });
        const [admin] = rows;
        if (admin) {
          await recordAudit(tx, {
            tenantId: admin.tenantId,
            action: 'admin.mfa.reset',
            actor: { type: 'cli' },
            target: { type: 'admin', id: admin.id, label: email.data },
            occurredAt: new Date(),
          });
        }
        return rows;
      });
      if (updated.length === 0) fail('Bu e-postayla yönetici bulunamadı.');
      // Oturum sürümü arttı: açık oturumlar bir sonraki istekte düşer.
      print(`MFA sıfırlandı: ${email.data}. Bir sonraki girişte yeniden kurulacak.`);
      return;
    }

    fail('Komut: create | reset-mfa');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
