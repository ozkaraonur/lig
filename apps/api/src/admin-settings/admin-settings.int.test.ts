import { randomUUID } from 'node:crypto';
import {
  ADMIN_SESSION_COOKIE_NAME,
  type AdminQuestView,
  type AdminRole,
  type BrandingView,
} from '@lig/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import { configureApp } from '../app.setup';
import { verifyAuditChain } from '../audit/audit-log';
import { AuditModule } from '../audit/audit.module';
import { DrizzleTenantDirectory } from '../auth/drizzle-adapters';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { DB, DbModule, type Database } from '../db/db.module';
import { adminUsers, auditEvents, players, quests, xpLedger } from '../db/schema';
import { questStore } from '../quests/quest-store';
import { RedisModule } from '../redis/redis.module';
import { SecretsModule } from '../secrets/secrets.module';
import { createTenant, deleteTenants } from '../test/integration.test-utils';
import { AdminSettingsModule } from './admin-settings.module';

/** Görev şablonları (FR-21) ve marka ayarları (FR-22), HTTP üzerinden gerçek PostgreSQL ve Redis ile. */
let app: NestFastifyApplication;
let db: Database;
let auth: AdminAuthService;
const tenantIds: string[] = [];

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
      AdminSettingsModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app, { webOrigin: 'http://localhost:3000' });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = app.get(DB);
  auth = app.get(AdminAuthService);
});

afterAll(async () => {
  await deleteTenants(db, tenantIds);
  await app.close();
});

async function newPlatform() {
  const tenantId = await createTenant(db, 'admin-settings');
  tenantIds.push(tenantId);
  const cookie = async (role: AdminRole) => {
    const [admin] = await db
      .insert(adminUsers)
      .values({
        tenantId,
        email: `${role}-${randomUUID()}@platform.test`,
        role,
        passwordHash: 'x',
        mfaSecretCiphertext: 'lig1.test',
        mfaEnabledAt: new Date(),
      })
      .returning({ id: adminUsers.id });
    return {
      [ADMIN_SESSION_COOKIE_NAME]: await auth.issueSession({ id: admin!.id, tenantId, sessionVersion: 0 }),
    };
  };
  return { tenantId, cookie };
}

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  cookies: Record<string, string>,
  payload?: object,
) => app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });

const questBody = (overrides: Record<string, unknown> = {}) => ({
  template: 'place_orders',
  period: 'weekly',
  targetCount: 5,
  xpReward: 100,
  ...overrides,
});

async function auditActions(tenantId: string) {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.chainKey, tenantId))
    .orderBy(auditEvents.seq);
  return rows;
}

describe('quest templates (FR-21)', () => {
  it('creates, edits and reaches players; refuses duplicates and cash-like fields', async () => {
    const p = await newPlatform();
    const editor = await p.cookie('editor');
    const viewer = await p.cookie('viewer');

    const created = await call('POST', '/admin/quests', editor, questBody());
    expect(created.statusCode).toBe(201);
    const quest = created.json<{ quest: AdminQuestView }>().quest;
    expect(quest).toMatchObject({
      template: 'place_orders',
      period: 'weekly',
      title: 'Bu hafta 5 emir ver',
      active: true,
      completions: 0,
      deletable: true,
    });

    const duplicate = await call('POST', '/admin/quests', editor, questBody({ targetCount: 9 }));
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('CONFLICT');

    for (const body of [
      questBody({ cashReward: '100' }),
      questBody({ template: 'made_up' }),
      questBody({ xpReward: 0 }),
      questBody({ targetCount: 0 }),
      questBody({ period: 'daily' }),
    ]) {
      expect((await call('POST', '/admin/quests', editor, body)).statusCode).toBe(400);
    }

    expect(
      (await call('POST', '/admin/quests', viewer, questBody({ template: 'join_league' }))).statusCode,
    ).toBe(403);
    expect((await call('GET', '/admin/quests', viewer)).json().quests).toHaveLength(1);

    // Oyuncu tarafı görevi görüyor.
    const active = await questStore.listActive(db, p.tenantId);
    expect(active).toMatchObject([{ id: quest.id, targetCount: 5, xpReward: 100 }]);

    const edited = await call('PATCH', `/admin/quests/${quest.id}`, editor, {
      targetCount: 3,
      xpReward: 150,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().quest).toMatchObject({
      targetCount: 3,
      xpReward: 150,
      title: 'Bu hafta 3 emir ver',
    });
    expect((await questStore.listActive(db, p.tenantId))[0]).toMatchObject({ targetCount: 3, xpReward: 150 });

    // Pasife alınan görev oyuncuya gitmez.
    await call('PATCH', `/admin/quests/${quest.id}`, editor, { active: false });
    expect(await questStore.listActive(db, p.tenantId)).toHaveLength(0);

    // Şablon ve dönem değiştirilemez.
    expect(
      (await call('PATCH', `/admin/quests/${quest.id}`, editor, { template: 'join_league' })).statusCode,
    ).toBe(400);
    expect((await call('PATCH', `/admin/quests/${quest.id}`, editor, {})).statusCode).toBe(400);

    const events = await auditActions(p.tenantId);
    expect(events.map((e) => e.action)).toEqual(['quest.created', 'quest.updated', 'quest.updated']);
    expect(events[1]?.metadata).toMatchObject({
      targetCountFrom: 5,
      targetCountTo: 3,
      xpRewardFrom: 100,
      xpRewardTo: 150,
    });
    expect((await verifyAuditChain(db, p.tenantId)).ok).toBe(true);
  });

  it('deletes an unused quest but keeps one that already granted XP', async () => {
    const p = await newPlatform();
    const owner = await p.cookie('owner');
    const unused = (
      await call(
        'POST',
        '/admin/quests',
        owner,
        questBody({ template: 'join_league', period: 'once', targetCount: 1 }),
      )
    ).json().quest;
    const used = (await call('POST', '/admin/quests', owner, questBody())).json().quest;

    const [player] = await db
      .insert(players)
      .values({ tenantId: p.tenantId, externalId: randomUUID(), displayName: 'Oyuncu' })
      .returning({ id: players.id });
    await db.insert(xpLedger).values({
      playerId: player!.id,
      reason: 'quest',
      sourceId: `${used.id}:2026-W38`,
      amount: 100,
    });

    const listed = (await call('GET', '/admin/quests', owner)).json<{ quests: AdminQuestView[] }>().quests;
    expect(listed.find((q) => q.id === used.id)).toMatchObject({ completions: 1, deletable: false });
    expect(listed.find((q) => q.id === unused.id)).toMatchObject({ completions: 0, deletable: true });

    const blocked = await call('DELETE', `/admin/quests/${used.id}`, owner);
    expect(blocked.statusCode).toBe(409);
    expect(await db.select().from(quests).where(eq(quests.id, used.id))).toHaveLength(1);

    expect((await call('DELETE', `/admin/quests/${unused.id}`, owner)).statusCode).toBe(204);
    expect((await call('DELETE', `/admin/quests/${unused.id}`, owner)).statusCode).toBe(404);
    expect((await auditActions(p.tenantId)).at(-1)?.action).toBe('quest.deleted');
  });

  it('opens exactly one quest when the same template arrives ten times at once', async () => {
    const p = await newPlatform();
    const owner = await p.cookie('owner');

    // Aynı şablon ve dönem: tekil indeks olmadan on istek on görev açardı (K-023).
    const results = await Promise.all(
      Array.from({ length: 10 }, () => call('POST', '/admin/quests', owner, questBody())),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(9);
    expect(await db.select().from(quests).where(eq(quests.tenantId, p.tenantId))).toHaveLength(1);
    expect((await auditActions(p.tenantId)).filter((e) => e.action === 'quest.created')).toHaveLength(1);
    expect((await verifyAuditChain(db, p.tenantId)).ok).toBe(true);
  });

  it('keeps platforms apart', async () => {
    const a = await newPlatform();
    const b = await newPlatform();
    const ownerA = await a.cookie('owner');
    const ownerB = await b.cookie('owner');
    const quest = (await call('POST', '/admin/quests', ownerA, questBody())).json().quest;

    expect((await call('GET', '/admin/quests', ownerB)).json().quests).toHaveLength(0);
    expect((await call('PATCH', `/admin/quests/${quest.id}`, ownerB, { xpReward: 1 })).statusCode).toBe(404);
    expect((await call('DELETE', `/admin/quests/${quest.id}`, ownerB)).statusCode).toBe(404);
    // Aynı şablonu kendi platformunda açabilir.
    expect((await call('POST', '/admin/quests', ownerB, questBody())).statusCode).toBe(201);
  });
});

describe('branding (FR-22)', () => {
  it('changes the name, colour and logo and sends them to players', async () => {
    const p = await newPlatform();
    const editor = await p.cookie('editor');
    const viewer = await p.cookie('viewer');
    const directory = new DrizzleTenantDirectory(db);

    const initial = (await call('GET', '/admin/branding', viewer)).json<BrandingView>();
    expect(initial).toMatchObject({ primaryColor: '#c6f24e', logoUrl: null });

    expect((await call('PATCH', '/admin/branding', viewer, { primaryColor: '#123456' })).statusCode).toBe(
      403,
    );
    for (const body of [
      { primaryColor: 'mavi' },
      { primaryColor: '#12345' },
      { logoUrl: 'javascript:alert(1)' },
      { logoUrl: 'http://platform.test/logo.png' },
      { name: 'A' },
      { name: '<script>x</script>' },
      { theme: {} },
      {},
    ]) {
      expect((await call('PATCH', '/admin/branding', editor, body)).statusCode, JSON.stringify(body)).toBe(
        400,
      );
    }

    const updated = await call('PATCH', '/admin/branding', editor, {
      name: 'Kripto Borsam',
      primaryColor: '#1D3F8F',
      logoUrl: 'https://platform.test/logo.png',
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({
      name: 'Kripto Borsam',
      primaryColor: '#1d3f8f',
      logoUrl: 'https://platform.test/logo.png',
    });

    expect(await directory.findPublicInfo(p.tenantId)).toMatchObject({
      name: 'Kripto Borsam',
      branding: { primaryColor: '#1d3f8f', logoUrl: 'https://platform.test/logo.png' },
    });

    // Logoyu kaldırmak.
    await call('PATCH', '/admin/branding', editor, { logoUrl: null });
    expect((await directory.findPublicInfo(p.tenantId))?.branding.logoUrl).toBeNull();

    // Aynı değeri tekrar göndermek kayıt üretmez.
    await call('PATCH', '/admin/branding', editor, { name: 'Kripto Borsam' });
    const events = await auditActions(p.tenantId);
    expect(events.map((e) => e.action)).toEqual(['branding.changed', 'branding.changed']);
    expect(events[0]?.metadata).toMatchObject({
      nameTo: 'Kripto Borsam',
      primaryColorFrom: '#c6f24e',
      primaryColorTo: '#1d3f8f',
      logoUrlTo: 'https://platform.test/logo.png',
    });
    expect((await verifyAuditChain(db, p.tenantId)).ok).toBe(true);
  });
});
