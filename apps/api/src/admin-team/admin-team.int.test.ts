import { randomUUID } from 'node:crypto';
import { ADMIN_SESSION_COOKIE_NAME, type AdminRole, type AuditListResponse } from '@lig/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import { hashPassword } from '../admin-auth/password-hasher';
import { base32Decode, generateTotpSecret, totpCodeAt, totpStep } from '../admin-auth/totp';
import { configureApp } from '../app.setup';
import { verifyAuditChain } from '../audit/audit-log';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { DB, DbModule, type Database } from '../db/db.module';
import { adminInvites, adminUsers, auditEvents } from '../db/schema';
import { REDIS, RedisModule } from '../redis/redis.module';
import { SECRET_CIPHER, type SecretCipher, secretContext } from '../secrets/secret-cipher';
import { SecretsModule } from '../secrets/secrets.module';
import { createTenant, deleteTenants } from '../test/integration.test-utils';
import { AdminTeamModule } from './admin-team.module';

/**
 * Ekip, hesap ve denetim uçları gerçek PostgreSQL ve Redis ile, HTTP üzerinden. Kilitler, transaction içi
 * denetim kaydı ve eşzamanlı istekler bellek içi sahtelerle sınanamaz.
 */
let app: NestFastifyApplication;
let db: Database;
let redis: Redis;
let cipher: SecretCipher;
let auth: AdminAuthService;
const tenants: string[] = [];

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule,
      DbModule,
      RedisModule,
      SecretsModule,
      AuditModule,
      AuthModule,
      AdminAuthModule,
      AdminTeamModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app, { webOrigin: 'http://localhost:3000' });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = app.get(DB);
  redis = app.get(REDIS);
  cipher = app.get(SECRET_CIPHER);
  auth = app.get(AdminAuthService);
});

beforeEach(async () => {
  const keys = await redis.keys('rl:admin*');
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  await deleteTenants(db, tenants);
  await app.close();
});

async function newTenant(): Promise<string> {
  const id = await createTenant(db, 'admin-team');
  tenants.push(id);
  return id;
}

interface TestAdmin {
  id: string;
  email: string;
  tenantId: string;
  secret: string;
  cookie: Record<string, string>;
}

/** MFA'sı kurulu yönetici açar ve onun için oturum çerezi üretir. */
async function newAdmin(
  tenantId: string,
  role: AdminRole,
  password = 'entegrasyon-parolasi',
): Promise<TestAdmin> {
  const email = `${role}-${randomUUID()}@platform.test`;
  const [row] = await db
    .insert(adminUsers)
    .values({ tenantId, email, role, passwordHash: await hashPassword(password) })
    .returning({ id: adminUsers.id });
  const id = row!.id;
  const secret = generateTotpSecret();
  await db
    .update(adminUsers)
    .set({
      mfaSecretCiphertext: await cipher.encrypt(secret, secretContext.adminMfaSecret(id)),
      mfaEnabledAt: new Date(),
    })
    .where(eq(adminUsers.id, id));
  const token = await auth.issueSession({ id, tenantId, sessionVersion: 0 });
  return { id, email, tenantId, secret, cookie: { [ADMIN_SESSION_COOKIE_NAME]: token } };
}

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  cookies?: Record<string, string>,
  payload?: object,
) => app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });

const tokenFrom = (inviteUrl: string) => new URL(inviteUrl).hash.replace('#token=', '');

async function auditActions(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(eq(auditEvents.chainKey, tenantId))
    .orderBy(auditEvents.seq);
  return rows.map((r) => r.action);
}

describe('roles and tenant isolation', () => {
  it('opens team and audit only to owners of the same platform', async () => {
    const tenantId = await newTenant();
    const owner = await newAdmin(tenantId, 'owner');
    const editor = await newAdmin(tenantId, 'editor');
    const viewer = await newAdmin(tenantId, 'viewer');

    const team = await call('GET', '/admin/team', owner.cookie);
    expect(team.statusCode).toBe(200);
    expect(
      team
        .json()
        .admins.map((a: { email: string }) => a.email)
        .sort(),
    ).toEqual([owner.email, editor.email, viewer.email].sort());
    expect(JSON.stringify(team.json())).not.toMatch(/password|secret|hash/i);

    for (const admin of [editor, viewer]) {
      expect((await call('GET', '/admin/team', admin.cookie)).statusCode).toBe(403);
      expect((await call('GET', '/admin/audit', admin.cookie)).statusCode).toBe(403);
      expect(
        (await call('POST', '/admin/team/invites', admin.cookie, { email: 'x@y.test', role: 'owner' }))
          .statusCode,
      ).toBe(403);
    }

    const otherOwner = await newAdmin(await newTenant(), 'owner');
    for (const res of [
      await call('PATCH', `/admin/team/${editor.id}/role`, otherOwner.cookie, { role: 'owner' }),
      await call('POST', `/admin/team/${editor.id}/mfa-reset`, otherOwner.cookie),
      await call('DELETE', `/admin/team/${editor.id}`, otherOwner.cookie),
    ]) {
      expect(res.statusCode).toBe(404);
    }
    const [still] = await db.select().from(adminUsers).where(eq(adminUsers.id, editor.id));
    expect(still?.role).toBe('editor');
  });
});

describe('invites', () => {
  it('invites, accepts once and records both in the audit chain without the token', async () => {
    const tenantId = await newTenant();
    const owner = await newAdmin(tenantId, 'owner');
    const email = `davetli-${randomUUID()}@platform.test`;

    const created = await call('POST', '/admin/team/invites', owner.cookie, {
      email: email.toUpperCase(),
      role: 'editor',
    });
    expect(created.statusCode).toBe(201);
    const { inviteUrl, invite } = created.json();
    expect(invite).toMatchObject({ email, role: 'editor', expired: false });
    expect(inviteUrl).toMatch(/^http:\/\/localhost:3000\/admin\/invite#token=[A-Za-z0-9_-]{43}$/);
    const token = tokenFrom(inviteUrl);
    const [stored] = await db.select().from(adminInvites).where(eq(adminInvites.id, invite.id));
    expect(stored?.tokenHash).not.toContain(token);

    const lookup = await call('POST', '/admin/invites/lookup', undefined, { token });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json()).toMatchObject({ email, role: 'editor' });

    expect(
      (await call('POST', '/admin/invites/accept', undefined, { token, password: 'kisa' })).statusCode,
    ).toBe(400);
    const accepted = await call('POST', '/admin/invites/accept', undefined, {
      token,
      password: 'davetli-parolasi-uzun',
    });
    expect(accepted.statusCode).toBe(201);
    const again = await call('POST', '/admin/invites/accept', undefined, {
      token,
      password: 'davetli-parolasi-uzun',
    });
    expect(again.statusCode).toBe(404);
    expect(again.json().code).toBe('INVITE_INVALID');
    expect((await call('POST', '/admin/invites/lookup', undefined, { token })).statusCode).toBe(404);

    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
    expect(admin).toMatchObject({ tenantId, role: 'editor', mfaSecretCiphertext: null });

    expect(await auditActions(tenantId)).toEqual(['admin.invited', 'admin.invite.accepted']);
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.chainKey, tenantId));
    expect(JSON.stringify(rows)).not.toContain(token);
    expect((await verifyAuditChain(db, tenantId)).ok).toBe(true);
  });

  it('lets only one of five parallel accepts win', async () => {
    const tenantId = await newTenant();
    const owner = await newAdmin(tenantId, 'owner');
    const email = `yaris-${randomUUID()}@platform.test`;
    const { inviteUrl } = (
      await call('POST', '/admin/team/invites', owner.cookie, { email, role: 'viewer' })
    ).json();
    const token = tokenFrom(inviteUrl);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call('POST', '/admin/invites/accept', undefined, { token, password: 'yaris-parolasi-uzun' }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 404, 404, 404, 404]);
    expect(await db.select().from(adminUsers).where(eq(adminUsers.email, email))).toHaveLength(1);
  });

  it('refuses expired, revoked and replaced invites, and existing members', async () => {
    const tenantId = await newTenant();
    const owner = await newAdmin(tenantId, 'owner');
    const email = `eski-${randomUUID()}@platform.test`;

    const first = tokenFrom(
      (await call('POST', '/admin/team/invites', owner.cookie, { email, role: 'viewer' })).json().inviteUrl,
    );
    const second = (
      await call('POST', '/admin/team/invites', owner.cookie, { email, role: 'editor' })
    ).json();
    expect((await call('POST', '/admin/invites/lookup', undefined, { token: first })).statusCode).toBe(404);

    const revoke = await call('DELETE', `/admin/team/invites/${second.invite.id}`, owner.cookie);
    expect(revoke.statusCode).toBe(204);
    expect(
      (await call('POST', '/admin/invites/lookup', undefined, { token: tokenFrom(second.inviteUrl) }))
        .statusCode,
    ).toBe(404);

    const third = (await call('POST', '/admin/team/invites', owner.cookie, { email, role: 'viewer' })).json();
    await db
      .update(adminInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(adminInvites.id, third.invite.id));
    const expired = await call('POST', '/admin/invites/accept', undefined, {
      token: tokenFrom(third.inviteUrl),
      password: 'suresi-dolmus-parola',
    });
    expect(expired.statusCode).toBe(404);

    const member = await call('POST', '/admin/team/invites', owner.cookie, {
      email: owner.email,
      role: 'viewer',
    });
    expect(member.statusCode).toBe(409);
  });

  it('keeps the invite usable when the email already belongs to another platform', async () => {
    const tenantA = await newTenant();
    const ownerA = await newAdmin(tenantA, 'owner');
    const elsewhere = await newAdmin(await newTenant(), 'viewer');
    const { inviteUrl } = (
      await call('POST', '/admin/team/invites', ownerA.cookie, { email: elsewhere.email, role: 'editor' })
    ).json();
    const res = await call('POST', '/admin/invites/accept', undefined, {
      token: tokenFrom(inviteUrl),
      password: 'baska-platform-parola',
    });
    expect(res.statusCode).toBe(409);
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, elsewhere.email));
    expect(admin?.tenantId).toBe(elsewhere.tenantId);
  });
});

describe('member changes', () => {
  it('changes roles, never on yourself, and never leaves a platform without an owner (race)', async () => {
    const tenantId = await newTenant();
    const a = await newAdmin(tenantId, 'owner');
    const b = await newAdmin(tenantId, 'owner');
    const editor = await newAdmin(tenantId, 'editor');

    expect(
      (await call('PATCH', `/admin/team/${editor.id}/role`, a.cookie, { role: 'viewer' })).statusCode,
    ).toBe(204);
    expect((await call('PATCH', `/admin/team/${a.id}/role`, a.cookie, { role: 'editor' })).statusCode).toBe(
      403,
    );

    // İki sahip aynı anda birbirini düşürüyor: yalnızca biri başarılı olur. Zamanlama şansa kalmasın diye
    // aynı yarış 10 ayrı platformda aynı anda çalıştırılır.
    const [ab, ba] = await Promise.all([
      call('PATCH', `/admin/team/${b.id}/role`, a.cookie, { role: 'editor' }),
      call('PATCH', `/admin/team/${a.id}/role`, b.cookie, { role: 'editor' }),
    ]);
    expect([ab.statusCode, ba.statusCode].sort()).toEqual([204, 403]);
    const owners = await db
      .select()
      .from(adminUsers)
      .where(and(eq(adminUsers.tenantId, tenantId), eq(adminUsers.role, 'owner')));
    expect(owners).toHaveLength(1);

    const races = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const t = await newTenant();
        const x = await newAdmin(t, 'owner');
        const y = await newAdmin(t, 'owner');
        return { t, x, y };
      }),
    );
    await Promise.all(
      races.flatMap(({ x, y }) => [
        call('PATCH', `/admin/team/${y.id}/role`, x.cookie, { role: 'viewer' }),
        call('PATCH', `/admin/team/${x.id}/role`, y.cookie, { role: 'viewer' }),
      ]),
    );
    for (const { t } of races) {
      const left = await db
        .select()
        .from(adminUsers)
        .where(and(eq(adminUsers.tenantId, t), eq(adminUsers.role, 'owner')));
      expect(left).toHaveLength(1);
    }

    const actions = await auditActions(tenantId);
    expect(actions.filter((x) => x === 'admin.role.changed')).toHaveLength(2);
    expect((await verifyAuditChain(db, tenantId)).ok).toBe(true);
  });

  it('resets MFA and removes members, which ends their sessions', async () => {
    const tenantId = await newTenant();
    const owner = await newAdmin(tenantId, 'owner');
    const target = await newAdmin(tenantId, 'editor');
    const other = await newAdmin(tenantId, 'viewer');
    expect((await call('GET', '/admin/auth/me', target.cookie)).statusCode).toBe(200);

    expect((await call('POST', `/admin/team/${target.id}/mfa-reset`, owner.cookie)).statusCode).toBe(204);
    expect((await call('GET', '/admin/auth/me', target.cookie)).statusCode).toBe(401);
    const [reset] = await db.select().from(adminUsers).where(eq(adminUsers.id, target.id));
    expect(reset).toMatchObject({ mfaSecretCiphertext: null, sessionVersion: 1 });
    expect((await call('POST', `/admin/team/${owner.id}/mfa-reset`, owner.cookie)).statusCode).toBe(403);

    expect((await call('GET', '/admin/auth/me', other.cookie)).statusCode).toBe(200);
    expect((await call('DELETE', `/admin/team/${other.id}`, owner.cookie)).statusCode).toBe(204);
    expect((await call('GET', '/admin/auth/me', other.cookie)).statusCode).toBe(401);
    expect((await call('DELETE', `/admin/team/${owner.id}`, owner.cookie)).statusCode).toBe(403);

    // Silinen yöneticinin kayıtları kalır, zincir sağlam.
    expect(await auditActions(tenantId)).toEqual(['admin.mfa.reset', 'admin.removed']);
    expect((await verifyAuditChain(db, tenantId)).ok).toBe(true);
  });
});

describe('account', () => {
  it('changes the password, ends every other session and keeps this browser signed in', async () => {
    // Düşük entropili test değerleri; gerçek parola değil.
    const oldOne = 'eski-parola-uzun-1';
    const newOne = 'yeni-parola-uzun-2';
    const wrongOne = 'yanlis-parola-uzun';
    const tenantId = await newTenant();
    const me = await newAdmin(tenantId, 'viewer', oldOne);
    const phone = {
      [ADMIN_SESSION_COOKIE_NAME]: await auth.issueSession({ id: me.id, tenantId, sessionVersion: 0 }),
    };

    const wrong = await call('POST', '/admin/account/password', me.cookie, {
      currentPassword: wrongOne,
      newPassword: newOne,
    });
    expect(wrong.statusCode).toBe(401);
    const same = await call('POST', '/admin/account/password', me.cookie, {
      currentPassword: oldOne,
      newPassword: oldOne,
    });
    expect(same.statusCode).toBe(400);

    const ok = await call('POST', '/admin/account/password', me.cookie, {
      currentPassword: oldOne,
      newPassword: newOne,
    });
    expect(ok.statusCode).toBe(204);
    const fresh = ok.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME);
    expect(fresh).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/admin' });

    expect((await call('GET', '/admin/auth/me', me.cookie)).statusCode).toBe(401);
    expect((await call('GET', '/admin/auth/me', phone)).statusCode).toBe(401);
    const newCookie = { [ADMIN_SESSION_COOKIE_NAME]: fresh!.value };
    expect((await call('GET', '/admin/auth/me', newCookie)).statusCode).toBe(200);

    const login = await call('POST', '/admin/auth/login', undefined, {
      email: me.email,
      password: newOne,
    });
    expect(login.statusCode).toBe(200);

    const revoke = await call('POST', '/admin/account/sessions/revoke-others', newCookie);
    expect(revoke.statusCode).toBe(204);
    expect((await call('GET', '/admin/auth/me', newCookie)).statusCode).toBe(401);
    const latest = {
      [ADMIN_SESSION_COOKIE_NAME]: revoke.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)!.value,
    };
    expect((await call('GET', '/admin/auth/me', latest)).statusCode).toBe(200);

    expect(await auditActions(tenantId)).toEqual(['admin.password.changed', 'admin.sessions.revoked']);
  });
});

describe('audit endpoints', () => {
  it('pages through the platform chain, verifies it and records a real login', async () => {
    const tenantId = await newTenant();
    const owner = await newAdmin(tenantId, 'owner', 'sahip-parolasi-uzun');
    const outsider = await newAdmin(await newTenant(), 'owner');

    // Gerçek giriş: parola + güncel TOTP kodu.
    const login = await call('POST', '/admin/auth/login', undefined, {
      email: owner.email,
      password: 'sahip-parolasi-uzun',
    });
    const code = totpCodeAt(base32Decode(owner.secret), totpStep(Math.floor(Date.now() / 1000)));
    const pre = login.cookies.find((c) => c.name === 'lig_admin_preauth')!.value;
    const verified = await call('POST', '/admin/auth/mfa/verify', { lig_admin_preauth: pre }, { code });
    expect(verified.statusCode).toBe(200);

    for (let i = 0; i < 4; i++) {
      await call('POST', '/admin/team/invites', owner.cookie, {
        email: `sayfa-${i}-${randomUUID()}@platform.test`,
        role: 'viewer',
      });
    }
    const first = await call('GET', '/admin/audit?limit=3', owner.cookie);
    expect(first.statusCode).toBe(200);
    const page1 = first.json<AuditListResponse>();
    expect(page1.events).toHaveLength(3);
    expect(page1.events[0]).toMatchObject({
      action: 'admin.invited',
      actorType: 'admin',
      actorEmail: owner.email,
    });
    expect(page1.nextBefore).toBe(page1.events[2]!.seq);
    const page2 = (
      await call('GET', `/admin/audit?limit=3&before=${page1.nextBefore}`, owner.cookie)
    ).json<AuditListResponse>();
    expect(page2.events.map((e) => e.action)).toEqual(['admin.invited', 'admin.login.succeeded']);
    expect(page2.nextBefore).toBeNull();

    const verify = await call('GET', '/admin/audit/verify', owner.cookie);
    expect(verify.json()).toMatchObject({ ok: true, checked: 5, brokenAtSeq: null });

    const theirs = (await call('GET', '/admin/audit', outsider.cookie)).json<AuditListResponse>();
    expect(theirs.events).toHaveLength(0);
    expect((await call('GET', '/admin/audit?limit=1000', owner.cookie)).statusCode).toBe(400);
  });
});
