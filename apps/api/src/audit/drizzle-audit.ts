import { Inject, Injectable } from '@nestjs/common';
import { type AuditAction, type AuditActorType, type AuditEventView } from '@lig/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { auditEvents } from '../db/schema';
import {
  appendAudit,
  type AuditEntry,
  type AuditLog,
  type AuditMetadata,
  verifyAuditChain,
} from './audit-log';

@Injectable()
export class DrizzleAuditLog implements AuditLog {
  constructor(@Inject(DB) private readonly db: Database) {}

  append(entry: AuditEntry): Promise<void> {
    return appendAudit(this.db, entry);
  }
}

export interface AuditReader {
  list(tenantId: string, before: number | undefined, limit: number): Promise<AuditEventView[]>;
  verify(tenantId: string): ReturnType<typeof verifyAuditChain>;
}

export const AUDIT_READER = Symbol('AUDIT_READER');

@Injectable()
export class DrizzleAuditReader implements AuditReader {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(tenantId: string, before: number | undefined, limit: number): Promise<AuditEventView[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.chainKey, tenantId),
          before === undefined ? undefined : lt(auditEvents.seq, before),
        ),
      )
      .orderBy(desc(auditEvents.seq))
      .limit(limit);
    return rows.map((row) => ({
      seq: row.seq,
      occurredAt: row.occurredAt.toISOString(),
      action: row.action as AuditAction,
      actorType: row.actorType as AuditActorType,
      actorEmail: row.actorEmail,
      targetType: row.targetType,
      targetLabel: row.targetLabel,
      ip: row.ip,
      metadata: (row.metadata ?? {}) as AuditMetadata,
    }));
  }

  verify(tenantId: string) {
    return verifyAuditChain(this.db, tenantId);
  }
}
