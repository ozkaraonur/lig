import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Ortam değişkenlerini doğrular. Eksik ya da hatalı bir değer varsa uygulama
 * başlamadan anlaşılır bir hatayla durur; değerlerin kendisi loga yazılmaz.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return result.data;
}

/** Yerel geliştirmede repo kökündeki .env dosyasını yükler. Üretimde ortam değişkenleri dışarıdan gelir. */
export function loadEnv(): Env {
  const rootEnv = resolve(__dirname, '../../../../.env');
  if (process.env.NODE_ENV !== 'production' && existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }
  return parseEnv(process.env);
}

export const ENV = Symbol('ENV');
