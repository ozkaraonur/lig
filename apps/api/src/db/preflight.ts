/**
 * Veritabanı ve Redis'e ulaşılabiliyor mu? `db:migrate` ve entegrasyon testlerinden önce çalışır.
 * Ulaşılamazsa uzun bağlantı hatası yığını yerine ne yapılacağını söyleyen tek satır yazar.
 *
 * Kullanım: tsx src/db/preflight.ts            (sadece PostgreSQL)
 *           tsx src/db/preflight.ts --redis    (PostgreSQL + Redis)
 */
import * as crypto from 'node:crypto';
import Redis from 'ioredis';
import { Client } from 'pg';
import { loadEnv } from '../config/env';

const TIMEOUT_MS = 3_000;
const HINT = 'Docker Desktop açık mı? Açıksa: npm run infra:up';

/** Bağlantı dizesinden yalnızca sunucu:port; kullanıcı adı ve parola asla yazılmaz. */
function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port}`;
  } catch {
    return 'geçersiz adres';
  }
}

async function checkPostgres(url: string): Promise<string | null> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: TIMEOUT_MS });
  try {
    await client.connect();
    await client.query('select 1');
    return null;
  } catch {
    return `PostgreSQL'e ulaşılamadı (${hostOf(url)}). ${HINT}`;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkRedis(url: string): Promise<string | null> {
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: TIMEOUT_MS,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    await redis.ping();
    return null;
  } catch {
    return `Redis'e ulaşılamadı (${hostOf(url)}). ${HINT}`;
  } finally {
    redis.disconnect();
  }
}

/** Yönetici parolaları Node'un yerleşik argon2'si ile hash'lenir; 24.7'den eski Node'da yok. */
export function checkNodeVersion(): string | null {
  const hasArgon2 = typeof (crypto as unknown as { argon2?: unknown }).argon2 === 'function';
  return hasArgon2
    ? null
    : `Node ${process.versions.node} çok eski: 24.7 veya üstü gerekli (node -v). nodejs.org'dan güncel Node 24'ü kur.`;
}

export async function checkInfrastructure(options: { redis: boolean }): Promise<string[]> {
  const nodeProblem = checkNodeVersion();
  if (nodeProblem) return [nodeProblem];
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    return [
      `${err instanceof Error ? err.message : 'Ortam değişkenleri okunamadı'}. Repo kökünde .env var mı? (copy .env.example .env)`,
    ];
  }
  const checks = [checkPostgres(env.DATABASE_URL)];
  if (options.redis) checks.push(checkRedis(env.REDIS_URL));
  return (await Promise.all(checks)).filter((p): p is string => p !== null);
}

if (require.main === module) {
  checkInfrastructure({ redis: process.argv.includes('--redis') })
    .then((problems) => {
      for (const p of problems) console.error(`✗ ${p}`);
      process.exit(problems.length > 0 ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
