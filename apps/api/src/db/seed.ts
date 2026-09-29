/**
 * Yerel geliştirme verisi. Sahte platformları birer müşteri (tenant) olarak kaydeder:
 * açık anahtarlarını ve fiyat adreslerini yazar, varlıkları, ligleri ve görevleri oluşturur.
 * Tekrar çalıştırmak güvenlidir: var olan kayıtlar çoğaltılmaz.
 *
 * İki sahte müşteri vardır (Faz 2, 7. adım):
 * - Sahte Platform (kripto, koyu tema, 7/24 işlem)
 * - Sahte Aracı Kurum (BIST hisseleri, açık tema, seans saati ve tavan/taban kuralları)
 *
 * Kullanım: önce `npm run dev` (sahte platformlar açık olmalı), sonra ayrı bir terminalde `npm run db:seed`.
 */
import { DEFAULT_PRIMARY_COLOR, type ThemeMode } from '@lig/shared';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { z } from 'zod';
import { hashPassword } from '../admin-auth/password-hasher';
import { loadEnv } from '../config/env';
import { secretContext, type SecretCipher } from '../secrets/secret-cipher';
import { createSecretCipher } from '../secrets/secrets.module';
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

interface SeedAsset {
  symbol: string;
  name: string;
  assetClass: 'crypto' | 'equity';
  sector?: string;
}

const CRYPTO_ASSETS: SeedAsset[] = [
  { symbol: 'BTC', name: 'Bitcoin', assetClass: 'crypto' },
  { symbol: 'ETH', name: 'Ethereum', assetClass: 'crypto' },
  { symbol: 'SOL', name: 'Solana', assetClass: 'crypto' },
  { symbol: 'AVAX', name: 'Avalanche', assetClass: 'crypto' },
  { symbol: 'XRP', name: 'XRP', assetClass: 'crypto' },
  { symbol: 'DOGE', name: 'Dogecoin', assetClass: 'crypto' },
];

/** BIST hisseleri. Fiyatlar ve şirket eşleşmeleri sahtedir; gerçek piyasa verisi değildir. */
const EQUITY_ASSETS: SeedAsset[] = [
  { symbol: 'THYAO', name: 'Türk Hava Yolları', assetClass: 'equity', sector: 'Ulaştırma' },
  { symbol: 'GARAN', name: 'Garanti BBVA', assetClass: 'equity', sector: 'Bankacılık' },
  { symbol: 'AKBNK', name: 'Akbank', assetClass: 'equity', sector: 'Bankacılık' },
  { symbol: 'ASELS', name: 'Aselsan', assetClass: 'equity', sector: 'Savunma' },
  { symbol: 'EREGL', name: 'Ereğli Demir Çelik', assetClass: 'equity', sector: 'Metal' },
  { symbol: 'BIMAS', name: 'BİM Mağazalar', assetClass: 'equity', sector: 'Perakende' },
  { symbol: 'TUPRS', name: 'Tüpraş', assetClass: 'equity', sector: 'Enerji' },
  { symbol: 'SISE', name: 'Şişecam', assetClass: 'equity', sector: 'Sanayi' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Varsayılan görevler (FR-07). Panelden şablonlarla da tanımlanabilir (FR-21). */
const SEED_QUESTS = [
  { template: 'join_league', period: 'once', targetCount: 1, xpReward: 50 },
  { template: 'place_orders', period: 'weekly', targetCount: 5, xpReward: 100 },
  { template: 'trade_distinct_assets', period: 'weekly', targetCount: 3, xpReward: 150 },
  { template: 'real_trade', period: 'weekly', targetCount: 1, xpReward: 250 },
] as const;

/** Yalnızca BIST gibi sektör bilgisi olan platformlara eklenir. */
const SECTOR_QUEST = {
  template: 'buy_distinct_sectors',
  period: 'weekly',
  targetCount: 3,
  xpReward: 150,
} as const;

interface SeedTenant {
  name: string;
  /** Sahte müşterinin adresi; anahtar, fiyat akışı ve gerçek işlem sayfası buradan gelir. */
  baseUrl: string;
  assets: SeedAsset[];
  leagueNames: { weekly: string; season: string; upcoming: string; past: string };
  theme: { primaryColor: string; themeMode: ThemeMode };
  /** Yerel geliştirme yöneticisi. Bu parola gizli değildir; üretimde bu hesap açılmaz. */
  admin: { email: string; password: string };
  webhookSecretEnv: string;
}

const DEV_WEBHOOK_SECRET = 'dev-only-webhook-secret-change-me';

const TENANTS: SeedTenant[] = [
  {
    name: 'Sahte Platform',
    baseUrl: process.env.MOCK_PLATFORM_URL ?? 'http://127.0.0.1:4100',
    assets: CRYPTO_ASSETS,
    leagueNames: {
      weekly: 'Haftalık Kripto Ligi',
      season: 'Sonbahar Sezonu',
      upcoming: 'Gelecek Haftanın Ligi',
      past: 'Geçen Haftanın Ligi',
    },
    theme: { primaryColor: DEFAULT_PRIMARY_COLOR, themeMode: 'dark' },
    admin: { email: 'yonetici@sahte-platform.test', password: 'gelistirme-yonetici-parolasi' },
    webhookSecretEnv: 'MOCK_PLATFORM_WEBHOOK_SECRET',
  },
  {
    name: 'Sahte Aracı Kurum',
    baseUrl: process.env.MOCK_BROKER_URL ?? 'http://127.0.0.1:4200',
    assets: EQUITY_ASSETS,
    leagueNames: {
      weekly: 'Haftalık BIST Ligi',
      season: 'Borsa Sezonu',
      upcoming: 'Gelecek Haftanın BIST Ligi',
      past: 'Geçen Haftanın BIST Ligi',
    },
    theme: { primaryColor: '#1d4ed8', themeMode: 'light' },
    admin: { email: 'yonetici@sahte-araci-kurum.test', password: 'gelistirme-yonetici-parolasi' },
    webhookSecretEnv: 'MOCK_BROKER_WEBHOOK_SECRET',
  },
];

/** Tarihler çalıştırma anına göre: her seed sonrası süren, başlayacak ve biten birer lig olur. */
function seedLeagues(now: number, names: SeedTenant['leagueNames']) {
  return [
    {
      name: names.weekly,
      type: 'weekly' as const,
      startsAt: new Date(now - 1 * DAY_MS),
      endsAt: new Date(now + 6 * DAY_MS),
    },
    {
      name: names.season,
      type: 'season' as const,
      startsAt: new Date(now - 7 * DAY_MS),
      endsAt: new Date(now + 83 * DAY_MS),
    },
    {
      name: names.upcoming,
      type: 'weekly' as const,
      startsAt: new Date(now + 6 * DAY_MS),
      endsAt: new Date(now + 13 * DAY_MS),
    },
    {
      name: names.past,
      type: 'weekly' as const,
      status: 'finished' as const,
      startsAt: new Date(now - 8 * DAY_MS),
      endsAt: new Date(now - 1 * DAY_MS),
    },
  ];
}

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function seedTenant(
  db: Db,
  cipher: SecretCipher,
  config: SeedTenant,
  isProduction: boolean,
): Promise<void> {
  const key = await fetchMockPlatformKey(config.baseUrl);
  const priceFeedUrl = `${config.baseUrl}/prices`;
  const realTradeUrl = `${config.baseUrl}/trade`;

  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name: config.name,
      ssoIssuer: key.issuer,
      ssoPublicKey: key.publicKeyPem,
      priceFeedUrl,
      realTradeUrl,
      theme: { primaryColor: config.theme.primaryColor, logoUrl: null, themeMode: config.theme.themeMode },
    })
    .onConflictDoUpdate({
      target: schema.tenants.ssoIssuer,
      set: { ssoPublicKey: key.publicKeyPem, priceFeedUrl, realTradeUrl },
    })
    .returning({ id: schema.tenants.id, name: schema.tenants.name });
  if (!tenant) throw new Error('Tenant oluşturulamadı.');

  // Sahte platformla aynı değer olmalı (apps/mock-platform/src/webhooks.ts). Üretimde platform başına rastgele.
  const webhookSecret = process.env[config.webhookSecretEnv] ?? DEV_WEBHOOK_SECRET;
  // Anahtar şifreli yazılır (K-015). Bağlam tenant kimliğini içerdiği için kayıt açıldıktan sonra yazılır.
  const webhookSecretCiphertext = await cipher.encrypt(
    webhookSecret,
    secretContext.tenantWebhookSecret(tenant.id),
  );
  await db.update(schema.tenants).set({ webhookSecretCiphertext }).where(eq(schema.tenants.id, tenant.id));
  console.warn(`Tenant hazır: ${tenant.name} (${tenant.id}), issuer: ${key.issuer}`);

  const assets = await db
    .insert(schema.assets)
    .values(config.assets.map((a) => ({ ...a, tenantId: tenant.id, sector: a.sector ?? null })))
    .onConflictDoUpdate({
      target: [schema.assets.tenantId, schema.assets.symbol],
      set: { name: sql`excluded.name`, sector: sql`excluded.sector` },
    })
    .returning({ id: schema.assets.id, symbol: schema.assets.symbol });
  console.warn(`Varlıklar hazır: ${assets.map((a) => a.symbol).join(', ')}`);

  let created = 0;
  for (const league of seedLeagues(Date.now(), config.leagueNames)) {
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

  let questsCreated = 0;
  // Sektör görevi yalnızca sektörü olan varlığı bulunan platformda anlamlı (kripto platformunda hiç ilerlemez).
  const hasSectors = config.assets.some((a) => a.sector);
  for (const quest of hasSectors ? [...SEED_QUESTS, SECTOR_QUEST] : SEED_QUESTS) {
    const [existing] = await db
      .select({ id: schema.quests.id })
      .from(schema.quests)
      .where(
        and(
          eq(schema.quests.tenantId, tenant.id),
          eq(schema.quests.template, quest.template),
          eq(schema.quests.period, quest.period),
        ),
      )
      .limit(1);
    if (existing) continue;
    await db.insert(schema.quests).values({ ...quest, tenantId: tenant.id });
    questsCreated++;
  }
  console.warn(`Görevler hazır: ${questsCreated} yeni görev eklendi.`);

  if (isProduction) {
    console.warn('Üretimde geliştirme yöneticisi açılmaz. "npm run admin:create" kullan.');
    return;
  }
  // Yalnızca yerel geliştirme hesabı. MFA ilk girişte kurulur.
  const password = process.env.SEED_ADMIN_PASSWORD ?? config.admin.password;
  const inserted = await db
    .insert(schema.adminUsers)
    .values({
      tenantId: tenant.id,
      email: config.admin.email,
      role: 'owner',
      passwordHash: await hashPassword(password),
    })
    .onConflictDoNothing({ target: schema.adminUsers.email })
    .returning({ id: schema.adminUsers.id });
  console.warn(
    inserted.length > 0
      ? `Yönetici hazır: ${config.admin.email} (parola .env'deki SEED_ADMIN_PASSWORD ya da README'deki geliştirme parolası)`
      : `Yönetici zaten var: ${config.admin.email}`,
  );
}

async function main(): Promise<void> {
  const env = loadEnv();
  const cipher = createSecretCipher(env);
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  try {
    for (const config of TENANTS) {
      await seedTenant(db, cipher, config, env.NODE_ENV === 'production');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
