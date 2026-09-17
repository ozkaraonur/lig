import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { auditEvents } from '../db/schema';
import { connectIntegration } from '../test/integration.test-utils';
import { appendAudit, type AuditEntry, verifyAuditChain } from './audit-log';
import { DrizzleAuditReader } from './drizzle-audit';

const ctx = connectIntegration();
const reader = new DrizzleAuditReader(ctx.db);

afterAll(async () => {
  await ctx.close();
});

const entry = (tenantId: string, overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  tenantId,
  action: 'admin.login.succeeded',
  actor: { type: 'admin', adminId: randomUUID(), email: 'ayse@platform.test' },
  target: { type: 'admin', id: randomUUID(), label: 'ayse@platform.test' },
  ip: '203.0.113.7',
  metadata: { z: 1, a: 'x', ok: true, none: null },
  occurredAt: new Date(),
  ...overrides,
});

class Rollback extends Error {}

/**
 * Veritabanı sahibinin yapabileceği bir saldırıyı taklit eder: tetikleyiciyi kapatıp kaydı değiştirir, sonra
 * zinciri doğrular. Hepsi geri alınan tek transaction'da olur; geliştirme veritabanında bozuk zincir kalmaz.
 */
async function verifyAfterTampering(tenantId: string, statement: ReturnType<typeof sql>) {
  let result: Awaited<ReturnType<typeof verifyAuditChain>> | undefined;
  await ctx.db
    .transaction(async (tx) => {
      await tx.execute(sql`alter table audit_events disable trigger audit_events_no_update_delete`);
      await tx.execute(statement);
      await tx.execute(sql`alter table audit_events enable trigger audit_events_no_update_delete`);
      result = await verifyAuditChain(tx, tenantId);
      throw new Rollback();
    })
    .catch((err: unknown) => {
      if (!(err instanceof Rollback)) throw err;
    });
  if (!result) throw new Error('verification did not run');
  return result;
}

describe('audit log (NFR-07, real PostgreSQL)', () => {
  it('refuses UPDATE, DELETE and TRUNCATE', async () => {
    const tenantId = randomUUID();
    await appendAudit(ctx.db, entry(tenantId));
    await expect(
      ctx.db.update(auditEvents).set({ action: 'admin.logout' }).where(eq(auditEvents.chainKey, tenantId)),
    ).rejects.toThrow();
    await expect(ctx.db.delete(auditEvents).where(eq(auditEvents.chainKey, tenantId))).rejects.toThrow();
    await expect(ctx.db.execute(sql`truncate audit_events`)).rejects.toThrow();
    expect((await verifyAuditChain(ctx.db, tenantId)).checked).toBe(1);
  });

  it('chains events per tenant, even when 30 are written at the same time', async () => {
    const tenantId = randomUUID();
    const other = randomUUID();
    await Promise.all(
      Array.from({ length: 30 }, (_, i) => appendAudit(ctx.db, entry(i % 3 === 0 ? other : tenantId))),
    );
    const mine = await verifyAuditChain(ctx.db, tenantId);
    const theirs = await verifyAuditChain(ctx.db, other);
    expect(mine).toMatchObject({ ok: true, checked: 20, brokenAtSeq: null });
    expect(theirs).toMatchObject({ ok: true, checked: 10 });
    expect(mine.lastHash).toMatch(/^[0-9a-f]{64}$/);

    const listed = await reader.list(tenantId, undefined, 50);
    expect(listed).toHaveLength(20);
    expect(listed[0]!.seq).toBeGreaterThan(listed[19]!.seq);
    expect(listed[0]!.metadata).toEqual({ z: 1, a: 'x', ok: true, none: null });
    const page = await reader.list(tenantId, listed[9]!.seq, 50);
    expect(page.map((e) => e.seq)).toEqual(listed.slice(10).map((e) => e.seq));
    expect((await reader.list(other, undefined, 50)).every((e) => !listed.some((m) => m.seq === e.seq))).toBe(
      true,
    );
  });

  // Değiştirilen kayıt kendi özetiyle, silinen kayıt ise bir sonrakinin "önceki özet" alanıyla yakalanır.
  it.each([
    [
      'a changed field',
      'itself',
      (seq: number) => sql`update audit_events set actor_email = 'saldirgan@x.test' where seq = ${seq}`,
    ],
    [
      'changed metadata',
      'itself',
      (seq: number) => sql`update audit_events set metadata = '{"z":2}'::jsonb where seq = ${seq}`,
    ],
    ['a deleted middle event', 'next', (seq: number) => sql`delete from audit_events where seq = ${seq}`],
  ] as const)(
    'finds %s even when the attacker bypasses the trigger (reported at %s)',
    async (_label, at, change) => {
      const tenantId = randomUUID();
      for (let i = 0; i < 3; i++) await appendAudit(ctx.db, entry(tenantId, { metadata: { i } }));
      const events = await reader.list(tenantId, undefined, 10);
      const middle = events[1]!.seq;
      const result = await verifyAfterTampering(tenantId, change(middle));
      expect(result.ok).toBe(false);
      expect(result.brokenAtSeq).toBe(at === 'next' ? events[0]!.seq : middle);
    },
  );

  it('finds an event recomputed with a new hash (the next event still points to the old one)', async () => {
    const tenantId = randomUUID();
    for (let i = 0; i < 3; i++) await appendAudit(ctx.db, entry(tenantId, { metadata: { i } }));
    const events = await reader.list(tenantId, undefined, 10);
    const result = await verifyAfterTampering(
      tenantId,
      sql`update audit_events set hash = md5(random()::text) || md5(random()::text) where seq = ${events[1]!.seq}`,
    );
    expect(result.brokenAtSeq).toBe(events[1]!.seq);
    // Geri alındı: gerçek zincir sağlam.
    expect((await verifyAuditChain(ctx.db, tenantId)).ok).toBe(true);
  });
});
