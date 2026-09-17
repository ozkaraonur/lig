import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminUsers } from '../db/schema';
import { connectIntegration, createTenant, deleteTenants } from '../test/integration.test-utils';
import { DrizzleAdminRepository } from './drizzle-admin.repository';
import { hashPassword } from './password-hasher';
import { RedisTokenStore } from './redis-token-store';
import { adminSessionData } from './session-schemas';

const ctx = connectIntegration();
const repo = new DrizzleAdminRepository(ctx.db);
let tenantId: string;

beforeAll(async () => {
  tenantId = await createTenant(ctx.db, 'admin-auth');
});

afterAll(async () => {
  await deleteTenants(ctx.db, [tenantId]);
  await ctx.close();
});

async function newAdmin(email = `yonetici-${randomUUID()}@platform.test`) {
  const [row] = await ctx.db
    .insert(adminUsers)
    .values({ tenantId, email, passwordHash: await hashPassword('entegrasyon-parolasi') })
    .returning({ id: adminUsers.id });
  if (!row) throw new Error('admin insert failed');
  return { id: row.id, email };
}

describe('DrizzleAdminRepository (real PostgreSQL)', () => {
  it('finds by the normalized email and enforces lowercase, globally unique emails', async () => {
    const admin = await newAdmin();
    expect((await repo.findByEmail(admin.email))?.id).toBe(admin.id);
    await expect(
      ctx.db.insert(adminUsers).values({ tenantId, email: 'Buyuk@Platform.test', passwordHash: 'x' }),
    ).rejects.toThrow();
    const otherTenant = await createTenant(ctx.db, 'admin-auth-other');
    try {
      await expect(
        ctx.db.insert(adminUsers).values({ tenantId: otherTenant, email: admin.email, passwordHash: 'x' }),
      ).rejects.toThrow();
    } finally {
      await deleteTenants(ctx.db, [otherTenant]);
    }
  });

  it('refuses half-configured MFA rows', async () => {
    const admin = await newAdmin();
    await expect(
      ctx.db.update(adminUsers).set({ mfaSecretCiphertext: 'lig1.x' }).where(eq(adminUsers.id, admin.id)),
    ).rejects.toThrow();
  });

  it('enables MFA once, even when two enrollments race', async () => {
    const admin = await newAdmin();
    const results = await Promise.all([
      repo.enableMfa(admin.id, 'lig1.first', 100, new Date()),
      repo.enableMfa(admin.id, 'lig1.second', 100, new Date()),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const stored = await repo.findById(admin.id);
    expect(['lig1.first', 'lig1.second']).toContain(stored?.mfaSecretCiphertext);
    expect(stored?.mfaLastUsedStep).toBe(100);
  });

  it('lets exactly one of many parallel requests use the same code step', async () => {
    const admin = await newAdmin();
    await repo.enableMfa(admin.id, 'lig1.secret', 100, new Date());
    expect(await repo.consumeMfaStep(admin.id, 100)).toBe(false);
    const results = await Promise.all(Array.from({ length: 10 }, () => repo.consumeMfaStep(admin.id, 101)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await repo.consumeMfaStep(admin.id, 101)).toBe(false);
    expect(await repo.consumeMfaStep(admin.id, 102)).toBe(true);
    expect((await repo.findById(admin.id))?.mfaLastUsedStep).toBe(102);
  });

  it('returns the tenant name and records logins and rehashes', async () => {
    const admin = await newAdmin();
    expect(await repo.tenantName(tenantId)).toMatch(/^admin-auth-/);
    const at = new Date('2026-09-17T09:00:00Z');
    await repo.recordLogin(admin.id, at);
    await repo.updatePasswordHash(admin.id, '$argon2id$new');
    const [row] = await ctx.db.select().from(adminUsers).where(eq(adminUsers.id, admin.id));
    expect(row?.lastLoginAt?.toISOString()).toBe(at.toISOString());
    expect(row?.passwordHash).toBe('$argon2id$new');
  });
});

describe('RedisTokenStore (real Redis)', () => {
  const prefix = `test-admin-session-${randomUUID()}`;
  const store = new RedisTokenStore(ctx.redis, prefix, adminSessionData);
  const keyOf = (token: string) => `${prefix}:${createHash('sha256').update(token).digest('hex')}`;

  afterAll(async () => {
    const keys = await ctx.redis.keys(`${prefix}:*`);
    if (keys.length > 0) await ctx.redis.del(...keys);
  });
  const data = { adminId: randomUUID(), tenantId: randomUUID(), createdAtMs: 1 };

  it('stores only the token digest as key and validates what it reads', async () => {
    const token = await store.create(data, 60);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await store.get(token)).toEqual(data);
    expect(await ctx.redis.keys(`*${token}*`)).toEqual([]);

    expect(await store.get('../../etc')).toBeNull();
    expect(await store.get('A'.repeat(43))).toBeNull();
  });

  it('replaces data without extending the lifetime, and touch extends it', async () => {
    const token = await store.create(data, 50);
    const key = keyOf(token);
    expect(await ctx.redis.exists(key)).toBe(1);
    await ctx.redis.expire(key, 20);
    expect(await store.replace(token, { ...data, createdAtMs: 2 })).toBe(true);
    expect(await ctx.redis.ttl(key)).toBeLessThanOrEqual(20);
    expect((await store.get(token))?.createdAtMs).toBe(2);

    await store.touch(token, 500);
    expect(await ctx.redis.ttl(key)).toBeGreaterThan(400);

    await store.destroy(token);
    expect(await store.get(token)).toBeNull();
    expect(await store.replace(token, data)).toBe(false);
  });

  it('ignores records with an unexpected shape', async () => {
    const token = await store.create(data, 60);
    await ctx.redis.set(keyOf(token), JSON.stringify({ adminId: 'not-a-uuid' }), 'KEEPTTL');
    expect(await store.get(token)).toBeNull();
  });
});
