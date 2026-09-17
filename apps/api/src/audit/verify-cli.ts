/**
 * Bütün denetim kaydı zincirlerini doğrular (NFR-07, K-019). Bozuk zincir varsa hata koduyla biter.
 * Kullanım: npm run audit:verify
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadEnv } from '../config/env';
import * as schema from '../db/schema';
import { verifyAuditChain } from './audit-log';

const print = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  try {
    const chains = await db
      .selectDistinct({ chainKey: schema.auditEvents.chainKey })
      .from(schema.auditEvents)
      .orderBy(schema.auditEvents.chainKey);
    let broken = 0;
    for (const { chainKey } of chains) {
      const result = await verifyAuditChain(db, chainKey);
      if (result.ok) {
        print(`✓ ${chainKey}: ${result.checked} kayıt, son özet ${result.lastHash?.slice(0, 16)}…`);
      } else {
        broken++;
        print(
          `✗ ${chainKey}: ${result.checked} kayıttan sonra bozuk, ilk bozuk kayıt #${result.brokenAtSeq}`,
        );
      }
    }
    if (chains.length === 0) print('Denetim kaydında henüz kayıt yok.');
    if (broken > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
