import { Inject, Injectable } from '@nestjs/common';
import { type AdminAssetView } from '@lig/shared';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { type AuditEntry, recordAudit, type Tx } from '../audit/audit-log';
import { DB, type Database } from '../db/db.module';
import { assets, leagues, memberships, tenants } from '../db/schema';
import {
  type AdminLeagueRecord,
  type AdminLeagueRepository,
  type ComplianceRepository,
  type ComplianceSettings,
  type NewLeague,
  type PatchPlanner,
} from './ports';

const leagueColumns = {
  id: leagues.id,
  tenantId: leagues.tenantId,
  name: leagues.name,
  type: leagues.type,
  status: leagues.status,
  startsAt: leagues.startsAt,
  endsAt: leagues.endsAt,
  startingCash: leagues.startingCash,
  assetIds: leagues.assetIds,
  maxMembers: leagues.maxMembers,
  lateJoinAllowed: leagues.lateJoinAllowed,
  // Tablo adı açık yazılır (K-008).
  memberCount: sql<number>`(select count(*) from memberships m where m.league_id = leagues.id)::int`,
};

@Injectable()
export class DrizzleAdminLeagueRepository implements AdminLeagueRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  list(tenantId: string): Promise<AdminLeagueRecord[]> {
    return this.db
      .select(leagueColumns)
      .from(leagues)
      .where(eq(leagues.tenantId, tenantId))
      .orderBy(desc(leagues.startsAt), asc(leagues.id))
      .limit(200);
  }

  async find(tenantId: string, leagueId: string): Promise<AdminLeagueRecord | null> {
    const [row] = await this.db
      .select(leagueColumns)
      .from(leagues)
      .where(and(eq(leagues.tenantId, tenantId), eq(leagues.id, leagueId)))
      .limit(1);
    return row ?? null;
  }

  listAssets(tenantId: string): Promise<AdminAssetView[]> {
    return this.db
      .select({ id: assets.id, symbol: assets.symbol, name: assets.name, assetClass: assets.assetClass })
      .from(assets)
      .where(eq(assets.tenantId, tenantId))
      .orderBy(asc(assets.symbol));
  }

  create(league: NewLeague, audit: (created: AdminLeagueRecord) => AuditEntry): Promise<AdminLeagueRecord> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(leagues).values(league).returning({ id: leagues.id });
      if (!row) throw new Error('League insert returned no row');
      const created = await this.lock(tx, league.tenantId, row.id);
      if (!created) throw new Error('Created league not found');
      await recordAudit(tx, audit(created));
      return created;
    });
  }

  update(tenantId: string, leagueId: string, plan: PatchPlanner): Promise<AdminLeagueRecord | null> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, tenantId, leagueId);
      if (!current) return null;
      const { patch, audit } = plan(current);
      if (Object.keys(patch).length === 0) return current;
      await tx
        .update(leagues)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(leagues.id, leagueId));
      if (audit) await recordAudit(tx, audit);
      return this.lock(tx, tenantId, leagueId);
    });
  }

  delete(
    tenantId: string,
    leagueId: string,
    check: (current: AdminLeagueRecord) => AuditEntry,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, tenantId, leagueId);
      if (!current) return false;
      const audit = check(current);
      await tx.delete(leagues).where(eq(leagues.id, leagueId));
      await recordAudit(tx, audit);
      return true;
    });
  }

  /**
   * Önce lig satırı kilitlenir, üye sayısı ayrı bir sorguyla sayılır: kilidi beklerken tamamlanan bir katılım
   * da sayıya girer (READ COMMITTED'da her sorgu kendi anının verisini görür). Katılım lig satırını FOR SHARE
   * ile okuduğu için bu kilit tutulurken yeni katılım yazılamaz.
   */
  private async lock(tx: Tx, tenantId: string, leagueId: string): Promise<AdminLeagueRecord | null> {
    const { memberCount: _count, ...columns } = leagueColumns;
    const [row] = await tx
      .select(columns)
      .from(leagues)
      .where(and(eq(leagues.tenantId, tenantId), eq(leagues.id, leagueId)))
      .for('update');
    if (!row) return null;
    const [counted] = await tx
      .select({ n: count() })
      .from(memberships)
      .where(eq(memberships.leagueId, leagueId));
    return { ...row, memberCount: counted?.n ?? 0 };
  }
}

@Injectable()
export class DrizzleComplianceRepository implements ComplianceRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async get(tenantId: string): Promise<ComplianceSettings | null> {
    const [row] = await this.db
      .select({
        realTradeButton: tenants.realTradeButtonEnabled,
        realTradeQuest: tenants.realTradeQuestEnabled,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return row ?? null;
  }

  update(
    tenantId: string,
    changes: Partial<ComplianceSettings>,
    audit: (before: ComplianceSettings, after: ComplianceSettings) => AuditEntry | null,
  ): Promise<ComplianceSettings | null> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({
          realTradeButton: tenants.realTradeButtonEnabled,
          realTradeQuest: tenants.realTradeQuestEnabled,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for('update');
      if (!before) return null;
      const after = { ...before, ...changes };
      const entry = audit(before, after);
      if (!entry) return before;
      await tx
        .update(tenants)
        .set({ realTradeButtonEnabled: after.realTradeButton, realTradeQuestEnabled: after.realTradeQuest })
        .where(eq(tenants.id, tenantId));
      await recordAudit(tx, entry);
      return after;
    });
  }
}
