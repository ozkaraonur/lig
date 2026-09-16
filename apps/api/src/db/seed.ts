/**
 * Yerel geliştirme verisi. Sahte platformu bir müşteri (tenant) olarak kaydeder:
 * açık anahtarını sahte platformdan alır, veritabanına yazar.
 *
 * Kullanım: önce `npm run dev` (sahte platform açık olmalı), sonra ayrı bir terminalde `npm run db:seed`.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { z } from 'zod';
import { loadEnv } from '../config/env';
import * as schema from './schema';

const publicKeyResponse = z.object({
  issuer: z.string().min(1),
  algorithm: z.literal('RS256'),
  publicKeyPem: z.string().startsWith('-----BEGIN PUBLIC KEY-----'),
});

async function fetchMockPlatformKey(baseUrl: string): Promise<z.infer<typeof publicKeyResponse>> {
  const url = `${baseUrl}/.well-known/lig-public-key`;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return publicKeyResponse.parse(await res.json());
    } catch {
      // sahte platform henüz açılmamış olabilir
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Sahte platforma ulaşılamadı (${url}). Önce "npm run dev" ile başlat.`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const mockUrl = process.env.MOCK_PLATFORM_URL ?? 'http://127.0.0.1:4100';
  const key = await fetchMockPlatformKey(mockUrl);

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  try {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: 'Sahte Platform', ssoIssuer: key.issuer, ssoPublicKey: key.publicKeyPem })
      .onConflictDoUpdate({ target: schema.tenants.ssoIssuer, set: { ssoPublicKey: key.publicKeyPem } })
      .returning({ id: schema.tenants.id, name: schema.tenants.name });
    console.warn(`Tenant hazır: ${tenant?.name} (${tenant?.id}), issuer: ${key.issuer}`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
