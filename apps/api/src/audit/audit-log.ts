import { createHash } from 'node:crypto';
import { type AuditAction, type AuditActorType } from '@lig/shared';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { type Database } from '../db/db.module';
import { auditEvents } from '../db/schema';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type AuditActor =
  | { type: 'admin'; adminId: string; email: string }
  | { type: 'cli' }
  | { type: 'system' }
  /** Kimliği henüz doğrulanmamış biri: hatalı parola ya da kod deneyen, daveti kabul eden. */
  | { type: 'anonymous' };

export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  /** Platforma bağlı olmayan olaylar (anahtar değişimi) için null. */
  tenantId: string | null;
  action: AuditAction;
  actor: AuditActor;
  target?: { type: string; id: string; label?: string | null };
  ip?: string | null;
  metadata?: AuditMetadata;
  occurredAt: Date;
}

/** Olayı ayrı bir transaction'la yazar (ör. giriş denemesi: yazılacak başka değişiklik yok). */
export interface AuditLog {
  append(entry: AuditEntry): Promise<void>;
}

export const AUDIT_LOG = Symbol('AUDIT_LOG');

export const SYSTEM_CHAIN = 'system';
const HASH_VERSION = 'lig-audit-v1';

interface HashFields {
  chainKey: string;
  prevHash: string | null;
  occurredAt: Date;
  action: string;
  actorType: string;
  actorAdminId: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  ip: string | null;
  metadata: AuditMetadata;
}

function stableMetadata(metadata: AuditMetadata): Array<[string, AuditMetadata[string]]> {
  return Object.keys(metadata)
    .sort()
    .map((key) => [key, metadata[key] ?? null]);
}

/** Alan sırası sabit bir dizi olarak özetlenir; JSON anahtar sırasına ya da boşluklara bağlı değildir. */
export function auditHash(fields: HashFields): string {
  const canonical = JSON.stringify([
    HASH_VERSION,
    fields.chainKey,
    fields.prevHash,
    fields.occurredAt.toISOString(),
    fields.action,
    fields.actorType,
    fields.actorAdminId,
    fields.actorEmail,
    fields.targetType,
    fields.targetId,
    fields.targetLabel,
    fields.ip,
    stableMetadata(fields.metadata),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Olayı çağıranın transaction'ı içinde yazar: değişiklik ve kaydı birlikte yazılır ya da ikisi de yazılmaz.
 * Zincir başına danışma kilidi alınır; aynı platformda aynı anda yazılan iki olay aynı "önceki özet"i alamaz.
 */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  const chainKey = entry.tenantId ?? SYSTEM_CHAIN;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${chainKey}`}, 0))`);
  const [last] = await tx
    .select({ hash: auditEvents.hash })
    .from(auditEvents)
    .where(eq(auditEvents.chainKey, chainKey))
    .orderBy(sql`${auditEvents.seq} desc`)
    .limit(1);

  const actorAdminId = entry.actor.type === 'admin' ? entry.actor.adminId : null;
  const actorEmail = entry.actor.type === 'admin' ? entry.actor.email : null;
  // Veritabanı milisaniyeden hassas saklar ama JavaScript Date zaten milisaniye; okununca aynı değer döner.
  const occurredAt = new Date(entry.occurredAt.getTime());
  const fields: HashFields = {
    chainKey,
    prevHash: last?.hash ?? null,
    occurredAt,
    action: entry.action,
    actorType: entry.actor.type,
    actorAdminId,
    actorEmail,
    targetType: entry.target?.type ?? null,
    targetId: entry.target?.id ?? null,
    targetLabel: entry.target?.label ?? null,
    ip: entry.ip ?? null,
    metadata: entry.metadata ?? {},
  };
  await tx.insert(auditEvents).values({
    ...fields,
    tenantId: entry.tenantId,
    hash: auditHash(fields),
  });
}

export async function appendAudit(db: Database, entry: AuditEntry): Promise<void> {
  await db.transaction((tx) => recordAudit(tx, entry));
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  lastHash: string | null;
}

const VERIFY_BATCH = 1_000;

/** Zinciri baştan sona yeniden hesaplar. İlk tutarsız kayıtta durur. */
export async function verifyAuditChain(db: Database | Tx, chainKey: string): Promise<ChainVerification> {
  let prevHash: string | null = null;
  let afterSeq = 0;
  let checked = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.chainKey, chainKey), gt(auditEvents.seq, afterSeq)))
      .orderBy(asc(auditEvents.seq))
      .limit(VERIFY_BATCH);
    for (const row of rows) {
      const expected = auditHash({
        chainKey: row.chainKey,
        prevHash,
        occurredAt: row.occurredAt,
        action: row.action,
        actorType: row.actorType,
        actorAdminId: row.actorAdminId,
        actorEmail: row.actorEmail,
        targetType: row.targetType,
        targetId: row.targetId,
        targetLabel: row.targetLabel,
        ip: row.ip,
        metadata: (row.metadata ?? {}) as AuditMetadata,
      });
      if (row.prevHash !== prevHash || row.hash !== expected) {
        return { ok: false, checked, brokenAtSeq: row.seq, lastHash: null };
      }
      prevHash = row.hash;
      checked++;
    }
    if (rows.length < VERIFY_BATCH) break;
    afterSeq = rows[rows.length - 1]!.seq;
  }
  return { ok: true, checked, brokenAtSeq: null, lastHash: prevHash };
}

export type { AuditActorType };
