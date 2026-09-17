/**
 * Demo ve test için 10 dakikalık bir lig açar: katıl, işlem yap, lig bitince sıralamanın donduğunu
 * ve XP ödüllerinin dağıtıldığını (FR-32) birkaç dakikada gör.
 *
 * Kullanım: önce `npm run db:seed`, sonra `npm run db:seed:quick`.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadEnv } from '../config/env';
import * as schema from './schema';

const DURATION_MINUTES = 10;

async function main(): Promise<void> {
  const env = loadEnv();
  const issuer = process.env.MOCK_PLATFORM_ISSUER ?? 'mock-platform';
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  try {
    const [tenant] = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.ssoIssuer, issuer))
      .limit(1);
    if (!tenant) throw new Error('Sahte platform kayıtlı değil. Önce "npm run db:seed" çalıştır.');

    const assets = await db
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(eq(schema.assets.tenantId, tenant.id));

    const now = Date.now();
    const endsAt = new Date(now + DURATION_MINUTES * 60_000);
    const time = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(endsAt);
    const [league] = await db
      .insert(schema.leagues)
      .values({
        tenantId: tenant.id,
        name: `Hızlı Lig · ${time}'de biter`,
        type: 'weekly',
        status: 'active',
        startsAt: new Date(now - 60_000),
        endsAt,
        startingCash: '100000.00',
        assetIds: assets.map((a) => a.id),
      })
      .returning({ id: schema.leagues.id, name: schema.leagues.name });
    console.warn(`Lig açıldı: ${league?.name}`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
