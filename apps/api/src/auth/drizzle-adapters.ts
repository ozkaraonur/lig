import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { players, tenants } from '../db/schema';
import { type PlayerRecord, type PlayerRepository, type TenantDirectory, type TenantKey } from './ports';

@Injectable()
export class DrizzleTenantDirectory implements TenantDirectory {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findByIssuer(issuer: string): Promise<TenantKey | null> {
    const [row] = await this.db
      .select({ id: tenants.id, issuer: tenants.ssoIssuer, publicKeyPem: tenants.ssoPublicKey })
      .from(tenants)
      .where(eq(tenants.ssoIssuer, issuer))
      .limit(1);
    if (!row?.issuer || !row.publicKeyPem) return null;
    return { tenantId: row.id, issuer: row.issuer, publicKeyPem: row.publicKeyPem };
  }
}

@Injectable()
export class DrizzlePlayerRepository implements PlayerRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async upsert(tenantId: string, externalId: string, displayName: string): Promise<PlayerRecord> {
    const [row] = await this.db
      .insert(players)
      .values({ tenantId, externalId, displayName })
      .onConflictDoUpdate({ target: [players.tenantId, players.externalId], set: { displayName } })
      .returning({ id: players.id, tenantId: players.tenantId, displayName: players.displayName });
    if (!row) throw new Error('Player upsert returned no row');
    return row;
  }

  /** Oyuncu her zaman tenant ile birlikte aranır: başka platformun oyuncusu asla dönmez (T4). */
  async findById(tenantId: string, playerId: string): Promise<PlayerRecord | null> {
    const [row] = await this.db
      .select({ id: players.id, tenantId: players.tenantId, displayName: players.displayName })
      .from(players)
      .where(and(eq(players.id, playerId), eq(players.tenantId, tenantId)))
      .limit(1);
    return row ?? null;
  }
}
