import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { loadEnv } from '../config/env';
import { type Database } from '../db/db.module';
import * as schema from '../db/schema';

export interface IntegrationContext {
  db: Database;
  redis: Redis;
  close(): Promise<void>;
}

/** Gerçek PostgreSQL ve Redis bağlantısı. Değerler .env ya da CI ortam değişkenlerinden gelir. */
export function connectIntegration(): IntegrationContext {
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 20 });
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  return {
    db: drizzle({ client: pool, schema, casing: 'snake_case' }),
    redis,
    async close() {
      await redis.quit();
      await pool.end();
    },
  };
}

/** Teste özel, rastgele adlı bir tenant açar. Silindiğinde bağlı her şey cascade ile gider. */
export async function createTenant(db: Database, name = 'test'): Promise<string> {
  const [row] = await db
    .insert(schema.tenants)
    .values({ name: `${name}-${randomUUID()}` })
    .returning({ id: schema.tenants.id });
  if (!row) throw new Error('tenant insert failed');
  return row.id;
}

export async function deleteTenants(db: Database, ids: string[]): Promise<void> {
  for (const id of ids) await db.delete(schema.tenants).where(eq(schema.tenants.id, id));
}
