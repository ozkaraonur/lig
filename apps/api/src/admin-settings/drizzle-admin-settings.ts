import { Inject, Injectable } from '@nestjs/common';
import { type BrandingView, DEFAULT_PRIMARY_COLOR, type QuestPeriod, type QuestTemplate } from '@lig/shared';
import { and, asc, count, eq, like, sql } from 'drizzle-orm';
import { type AuditEntry, recordAudit, type Tx } from '../audit/audit-log';
import { DB, type Database } from '../db/db.module';
import { quests, tenants, xpLedger } from '../db/schema';
import {
  type AdminQuestRecord,
  type AdminQuestRepository,
  type BrandingRepository,
  type CreateQuestResult,
  type NewQuest,
  type QuestPatch,
} from './ports';

const questColumns = {
  id: quests.id,
  template: quests.template,
  period: quests.period,
  targetCount: quests.targetCount,
  xpReward: quests.xpReward,
  active: quests.active,
  createdAt: quests.createdAt,
};

type QuestRow = {
  id: string;
  template: string;
  period: string;
  targetCount: number;
  xpReward: number;
  active: boolean;
  createdAt: Date;
};

/**
 * Görev XP'si `xp_ledger`'a `questId:dönem` kaynağıyla yazılır (K-011). Bir görevin kaç kez tamamlandığını
 * buradan sayarız; görev kaydı silinse bile verilmiş XP defterde kalır.
 */
async function completionsOf(db: Database | Tx, questId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(xpLedger)
    .where(and(eq(xpLedger.reason, 'quest'), like(xpLedger.sourceId, `${questId}:%`)));
  return row?.n ?? 0;
}

const toRecord = (row: QuestRow, completions: number): AdminQuestRecord => ({
  ...row,
  template: row.template as QuestTemplate,
  period: row.period as QuestPeriod,
  completions,
});

@Injectable()
export class DrizzleAdminQuestRepository implements AdminQuestRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(tenantId: string): Promise<AdminQuestRecord[]> {
    const rows = await this.db
      .select({
        ...questColumns,
        completions: sql<number>`(
          select count(*) from xp_ledger l
          where l.reason = 'quest' and l.source_id like quests.id::text || ':%'
        )::int`,
      })
      .from(quests)
      .where(eq(quests.tenantId, tenantId))
      .orderBy(asc(quests.createdAt), asc(quests.id));
    return rows.map((row) => toRecord(row, row.completions));
  }

  create(quest: NewQuest, audit: (created: AdminQuestRecord) => AuditEntry): Promise<CreateQuestResult> {
    return this.db.transaction(async (tx) => {
      // Aynı şablon ve dönemden ikinci görevi veritabanı engeller; eşzamanlı isteklerden yalnızca biri yazar.
      const inserted = await tx
        .insert(quests)
        .values(quest)
        .onConflictDoNothing({ target: [quests.tenantId, quests.template, quests.period] })
        .returning(questColumns);
      const [row] = inserted;
      if (!row) return { kind: 'duplicate' as const };
      const record = toRecord(row, 0);
      await recordAudit(tx, audit(record));
      return { kind: 'created' as const, quest: record };
    });
  }

  update(
    tenantId: string,
    questId: string,
    plan: (current: AdminQuestRecord) => { patch: QuestPatch; audit: AuditEntry | null },
  ): Promise<AdminQuestRecord | null> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, tenantId, questId);
      if (!current) return null;
      const { patch, audit } = plan(current);
      if (Object.keys(patch).length === 0) return current;
      await tx.update(quests).set(patch).where(eq(quests.id, questId));
      if (audit) await recordAudit(tx, audit);
      return this.lock(tx, tenantId, questId);
    });
  }

  remove(
    tenantId: string,
    questId: string,
    audit: (current: AdminQuestRecord) => AuditEntry,
  ): Promise<boolean | null> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, tenantId, questId);
      if (!current) return null;
      if (current.completions > 0) return false;
      await recordAudit(tx, audit(current));
      await tx.delete(quests).where(eq(quests.id, questId));
      return true;
    });
  }

  private async lock(tx: Tx, tenantId: string, questId: string): Promise<AdminQuestRecord | null> {
    const [row] = await tx
      .select(questColumns)
      .from(quests)
      .where(and(eq(quests.id, questId), eq(quests.tenantId, tenantId)))
      .for('update');
    return row ? toRecord(row, await completionsOf(tx, questId)) : null;
  }
}

interface StoredTheme {
  primaryColor?: string;
  logoUrl?: string | null;
}

function toBranding(name: string, theme: unknown): BrandingView {
  const stored = (theme ?? {}) as StoredTheme;
  return {
    name,
    primaryColor: stored.primaryColor ?? DEFAULT_PRIMARY_COLOR,
    logoUrl: stored.logoUrl ?? null,
  };
}

@Injectable()
export class DrizzleBrandingRepository implements BrandingRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async get(tenantId: string): Promise<BrandingView | null> {
    const [row] = await this.db
      .select({ name: tenants.name, theme: tenants.theme })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return row ? toBranding(row.name, row.theme) : null;
  }

  update(
    tenantId: string,
    changes: Partial<BrandingView>,
    audit: (before: BrandingView, after: BrandingView) => AuditEntry | null,
  ): Promise<BrandingView | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ name: tenants.name, theme: tenants.theme })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for('update');
      if (!row) return null;
      const before = toBranding(row.name, row.theme);
      const after = { ...before, ...changes };
      const entry = audit(before, after);
      if (!entry) return before;
      await tx
        .update(tenants)
        .set({ name: after.name, theme: { primaryColor: after.primaryColor, logoUrl: after.logoUrl } })
        .where(eq(tenants.id, tenantId));
      await recordAudit(tx, entry);
      return after;
    });
  }
}
