/**
 * Yerel geliştirme verisi. Sahte platformu bir müşteri (tenant) olarak kaydeder:
 * açık anahtarını ve fiyat adresini yazar, varlıkları ve örnek ligleri oluşturur.
 * Tekrar çalıştırmak güvenlidir: var olan kayıtlar çoğaltılmaz.
 *
 * Kullanım: önce `npm run dev` (sahte platform açık olmalı), sonra ayrı bir terminalde `npm run db:seed`.
 */
import { and, eq, sql } from 'drizzle-orm';
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

const SEED_ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'AVAX', name: 'Avalanche' },
  { symbol: 'XRP', name: 'XRP' },
  { symbol: 'DOGE', name: 'Dogecoin' },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tarihler çalıştırma anına göre: her seed sonrası süren, başlayacak ve biten birer lig olur. */
function seedLeagues(now: number) {
  return [
    {
      name: 'Haftalık Kripto Ligi',
      type: 'weekly' as const,
      startsAt: new Date(now - 1 * DAY_MS),
      endsAt: new Date(now + 6 * DAY_MS),
    },
    {
      name: 'Sonbahar Sezonu',
      type: 'season' as const,
      startsAt: new Date(now - 7 * DAY_MS),
      endsAt: new Date(now + 83 * DAY_MS),
    },
    {
      name: 'Gelecek Haftanın Ligi',
      type: 'weekly' as const,
      startsAt: new Date(now + 6 * DAY_MS),
      endsAt: new Date(now + 13 * DAY_MS),
    },
    {
      name: 'Geçen Haftanın Ligi',
      type: 'weekly' as const,
      status: 'finished' as const,
      startsAt: new Date(now - 8 * DAY_MS),
      endsAt: new Date(now - 1 * DAY_MS),
    },
  ];
}

async function main(): Promise<void> {
  const env = loadEnv();
  const mockUrl = process.env.MOCK_PLATFORM_URL ?? 'http://127.0.0.1:4100';
  const key = await fetchMockPlatformKey(mockUrl);

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  try {
    const priceFeedUrl = `${mockUrl}/prices`;
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: 'Sahte Platform', ssoIssuer: key.issuer, ssoPublicKey: key.publicKeyPem, priceFeedUrl })
      .onConflictDoUpdate({
        target: schema.tenants.ssoIssuer,
        set: { ssoPublicKey: key.publicKeyPem, priceFeedUrl },
      })
      .returning({ id: schema.tenants.id, name: schema.tenants.name });
    if (!tenant) throw new Error('Tenant oluşturulamadı.');
    console.warn(`Tenant hazır: ${tenant.name} (${tenant.id}), issuer: ${key.issuer}`);

    const assets = await db
      .insert(schema.assets)
      .values(SEED_ASSETS.map((a) => ({ ...a, tenantId: tenant.id, assetClass: 'crypto' as const })))
      .onConflictDoUpdate({
        target: [schema.assets.tenantId, schema.assets.symbol],
        set: { name: sql`excluded.name` },
      })
      .returning({ id: schema.assets.id, symbol: schema.assets.symbol });
    console.warn(`Varlıklar hazır: ${assets.map((a) => a.symbol).join(', ')}`);

    let created = 0;
    for (const league of seedLeagues(Date.now())) {
      const [existing] = await db
        .select({ id: schema.leagues.id })
        .from(schema.leagues)
        .where(and(eq(schema.leagues.tenantId, tenant.id), eq(schema.leagues.name, league.name)))
        .limit(1);
      if (existing) continue;
      await db.insert(schema.leagues).values({
        status: 'active' as const,
        ...league,
        tenantId: tenant.id,
        startingCash: '100000.00',
        assetIds: assets.map((a) => a.id),
      });
      created++;
    }
    console.warn(`Ligler hazır: ${created} yeni lig eklendi.`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
