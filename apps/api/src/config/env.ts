import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { parseKeyring } from '../secrets/local-secret-cipher';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /** Yerelde sadece bu bilgisayardan erişilsin diye varsayılan 127.0.0.1. Container içinde 0.0.0.0 verilir. */
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  /**
   * Arka plan işleri (fiyat alıcı, ileride görev kuyruğu) bu süreçte çalışsın mı. Üretimde API'yi birden çok
   * kopya çalıştırırken işler yalnızca birinde açık olur; aynı işi her kopya tekrar yapmaz (K-007).
   */
  WORKERS_ENABLED: z.stringbool().default(true),
  PRICE_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(1000),
  /** Sıralama yenileme ve lig kapanışı kontrol aralığı. NFR-01: sıralama 2 sn içinde güncellenir. */
  RANKING_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(2000),
  /** Görev olaylarının (outbox) kontrol aralığı. */
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(60_000).default(1000),
  /**
   * Veritabanındaki gizli değerleri şifreleyen anahtarlar (K-015): `k2:<base64>,k1:<base64>`, ilki etkin.
   * Üretimde zorunlu. Geliştirmede boş bırakılırsa herkesin bildiği geliştirme anahtarı kullanılır.
   */
  SECRET_KEYS: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => {
      if (v === undefined) return true;
      try {
        parseKeyring(v);
        return true;
      } catch {
        return false;
      }
    }),
});

const checkedEnvSchema = envSchema.refine((env) => env.NODE_ENV !== 'production' || env.SECRET_KEYS, {
  path: ['SECRET_KEYS'],
});

export type Env = z.infer<typeof envSchema>;

/**
 * Ortam değişkenlerini doğrular. Eksik ya da hatalı bir değer varsa uygulama
 * başlamadan anlaşılır bir hatayla durur; değerlerin kendisi loga yazılmaz.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = checkedEnvSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return result.data;
}

/** Bulunduğu klasörden yukarı doğru ilk .env dosyasını arar (build çıktısının derinliği değişebilir). */
function findEnvFile(startDir: string, maxDepth = 6): string | undefined {
  let dir = startDir;
  for (let i = 0; i < maxDepth; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/** Yerel geliştirmede repo kökündeki .env dosyasını yükler. Üretimde ortam değişkenleri dışarıdan gelir. */
export function loadEnv(): Env {
  if (process.env.NODE_ENV !== 'production') {
    const envFile = findEnvFile(__dirname);
    if (envFile) process.loadEnvFile(envFile);
  }
  return parseEnv(process.env);
}

export const ENV = Symbol('ENV');
