import { randomUUID } from 'node:crypto';
import { ADMIN_SESSION_COOKIE_NAME, type AdminLeagueView, type AdminRole } from '@lig/shared';
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
import {
  adminUsers,
  assets,
  auditEvents,
  leagues,
  memberships,
  players,
  quests,
  tenants,
} from '../db/schema';
import { DrizzleLeagueRepository } from '../leagues/drizzle-league.repository';
import { questStore } from '../quests/quest-store';
import { RedisModule } from '../redis/redis.module';
import { SecretsModule } from '../secrets/secrets.module';
import { createTenant, deleteTenants } from '../test/integration.test-utils';
import { AdminLeaguesModule } from './admin-leagues.module';

/** Lig yönetimi (FR-20) ve uyum ayarları (FR-24): HTTP üzerinden, gerçek PostgreSQL ve Redis ile. */
let app: NestFastifyApplication;
let db: Database;
let auth: AdminAuthService;
let playerLeagues: DrizzleLeagueRepository;
const tenantIds: string[] = [];

const DAY = 86_400_000;
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();

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
      AdminLeaguesModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app, { webOrigin: 'http://localhost:3000' });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = app.get(DB);
  auth = app.get(AdminAuthService);
  playerLeagues = new DrizzleLeagueRepository(db);
});

afterAll(async () => {
  await deleteTenants(db, tenantIds);
  await app.close();
});

interface Platform {
  tenantId: string;
  assetIds: string[];
  cookie: (role: AdminRole) => Promise<Record<string, string>>;
}

async function newPlatform(): Promise<Platform> {
  const tenantId = await createTenant(db, 'admin-leagues');
  tenantIds.push(tenantId);
  const rows = await db
    .insert(assets)
    .values(
      ['BTC', 'ETH', 'SOL'].map((symbol) => ({
        tenantId,
        symbol,
        name: symbol,
        assetClass: 'crypto' as const,
      })),
    )
    .returning({ id: assets.id });
  return {
    tenantId,
    assetIds: rows.map((r) => r.id),
    async cookie(role) {
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
      const token = await auth.issueSession({ id: admin!.id, tenantId, sessionVersion: 0 });
      return { [ADMIN_SESSION_COOKIE_NAME]: token };
    },
  };
}

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  cookies: Record<string, string>,
  payload?: object,
) => app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });

function leagueBody(p: Platform, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Kasım Ligi',
    type: 'weekly',
    startsAt: inDays(1),
    endsAt: inDays(8),
    startingCash: '100000',
    assetIds: p.assetIds.slice(0, 2),
    ...overrides,
  };
}

async function createLeague(
  p: Platform,
  cookie: Record<string, string>,
  overrides: Record<string, unknown> = {},
) {
  const res = await call('POST', '/admin/leagues', cookie, leagueBody(p, overrides));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ league: AdminLeagueView }>().league;
}

async function addMember(tenantId: string, leagueId: string) {
  const [player] = await db
    .insert(players)
    .values({ tenantId, externalId: randomUUID(), displayName: 'Oyuncu' })
    .returning({ id: players.id });
  return playerLeagues.createMembership(tenantId, leagueId, player!.id, new Date());
}

/** Ligi geçmişe taşır (testte "süren" ya da "biten" lig elde etmek için; API bunu yaptırmaz). */
async function moveLeague(leagueId: string, startsAt: string, endsAt: string, status?: 'finished') {
  await db
    .update(leagues)
    .set({ startsAt: new Date(startsAt), endsAt: new Date(endsAt), ...(status ? { status } : {}) })
    .where(eq(leagues.id, leagueId));
}

describe('roles and isolation', () => {
  it('lets every role read, only owner and editor write, and hides other platforms', async () => {
    const p = await newPlatform();
    const editor = await p.cookie('editor');
    const viewer = await p.cookie('viewer');
    const league = await createLeague(p, editor);
    expect(league).toMatchObject({ status: 'draft', phase: 'upcoming', memberCount: 0 });

    expect((await call('GET', '/admin/leagues', viewer)).json().leagues).toHaveLength(1);
    expect((await call('GET', '/admin/leagues/assets', viewer)).json().assets).toHaveLength(3);
    expect((await call('POST', '/admin/leagues', viewer, leagueBody(p))).statusCode).toBe(403);
    expect((await call('PATCH', `/admin/leagues/${league.id}`, viewer, { name: 'Yeni' })).statusCode).toBe(
      403,
    );
    expect((await call('DELETE', `/admin/leagues/${league.id}`, viewer)).statusCode).toBe(403);

    const other = await newPlatform();
    const outsider = await other.cookie('owner');
    expect((await call('GET', `/admin/leagues/${league.id}`, outsider)).statusCode).toBe(404);
    expect(
      (await call('PATCH', `/admin/leagues/${league.id}`, outsider, { name: 'Ele geçirildi' })).statusCode,
    ).toBe(404);
    expect((await call('DELETE', `/admin/leagues/${league.id}`, outsider)).statusCode).toBe(404);
    expect((await call('GET', '/admin/leagues', outsider)).json().leagues).toHaveLength(0);
    // Başka platformun varlığıyla lig kurulamaz.
    expect(
      (await call('POST', '/admin/leagues', outsider, leagueBody(other, { assetIds: [p.assetIds[0]] })))
        .statusCode,
    ).toBe(400);
  });
});

describe('create (FR-20)', () => {
  it.each([
    ['a start after the end', { startsAt: inDays(8), endsAt: inDays(1) }],
    ['a backdated start', { startsAt: inDays(-1) }],
    ['a league longer than 400 days', { endsAt: inDays(500) }],
    ['a league shorter than an hour', { endsAt: new Date(Date.now() + DAY + 60_000).toISOString() }],
    ['a cash reward (FR-24)', { cashReward: '5000' }],
    ['a closing date sent by the client', { closedAt: inDays(2) }],
  ])('rejects %s', async (_label, overrides) => {
    const p = await newPlatform();
    const res = await call('POST', '/admin/leagues', await p.cookie('owner'), leagueBody(p, overrides));
    expect(res.statusCode).toBe(400);
  });

  it('publishes, records the creation and shows the league to players', async () => {
    const p = await newPlatform();
    const league = await createLeague(p, await p.cookie('owner'), {
      publish: true,
      maxMembers: 50,
      lateJoinAllowed: false,
    });
    expect(league).toMatchObject({ status: 'active', maxMembers: 50, lateJoinAllowed: false });
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.chainKey, p.tenantId));
    expect(event).toMatchObject({ action: 'league.created', targetId: league.id });
    expect(event?.metadata).toMatchObject({ status: 'active', assets: 'BTC,ETH', maxMembers: 50 });
    expect(await addMember(p.tenantId, league.id)).not.toBeNull();
  });
});

describe('edit rules by phase (FR-20)', () => {
  it('upcoming with a member: name and assets change, starting cash, unpublish and delete do not', async () => {
    const p = await newPlatform();
    const owner = await p.cookie('owner');
    const league = await createLeague(p, owner, { publish: true });
    await addMember(p.tenantId, league.id);

    const renamed = await call('PATCH', `/admin/leagues/${league.id}`, owner, {
      name: 'Aralık Ligi',
      assetIds: [p.assetIds[2]!],
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().league).toMatchObject({
      name: 'Aralık Ligi',
      assetIds: [p.assetIds[2]],
      editable: { startingCash: false },
    });

    const cash = await call('PATCH', `/admin/leagues/${league.id}`, owner, { startingCash: '5000000' });
    expect(cash.statusCode).toBe(409);
    expect(cash.json()).toMatchObject({ code: 'LEAGUE_LOCKED' });
    expect((await call('PATCH', `/admin/leagues/${league.id}`, owner, { status: 'draft' })).statusCode).toBe(
      409,
    );
    expect((await call('DELETE', `/admin/leagues/${league.id}`, owner)).statusCode).toBe(409);
    // Aynı değeri göndermek değişiklik sayılmaz.
    expect(
      (await call('PATCH', `/admin/leagues/${league.id}`, owner, { startingCash: '100000.00' })).statusCode,
    ).toBe(200);
  });

  it('running: start, balance, type and asset removal are locked; end cannot be pulled to now', async () => {
    const p = await newPlatform();
    const owner = await p.cookie('owner');
    const league = await createLeague(p, owner, { publish: true });
    await moveLeague(league.id, inDays(-1), inDays(6));
    await addMember(p.tenantId, league.id);
    const patch = (body: object) => call('PATCH', `/admin/leagues/${league.id}`, owner, body);

    for (const body of [
      { startsAt: inDays(0.5) },
      { startingCash: '1' + '0'.repeat(6) },
      { type: 'season' },
      { assetIds: [p.assetIds[0]!] },
    ]) {
      const res = await patch(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(409);
    }
    expect((await patch({ endsAt: new Date(Date.now() + 60_000).toISOString() })).statusCode).toBe(400);
    expect((await patch({ maxMembers: 0 })).statusCode).toBe(400);

    const ok = await patch({
      endsAt: inDays(10),
      assetIds: [...p.assetIds],
      maxMembers: 5,
      lateJoinAllowed: false,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().league).toMatchObject({
      phase: 'running',
      maxMembers: 5,
      lateJoinAllowed: false,
      assetIds: p.assetIds,
    });

    // Geç katılım kapandı: süren lige yeni oyuncu giremez.
    expect(await addMember(p.tenantId, league.id)).toBeNull();
    await patch({ lateJoinAllowed: true });
    for (let i = 0; i < 3; i++) await addMember(p.tenantId, league.id);
    const below = await patch({ maxMembers: 2 });
    expect(below.statusCode).toBe(400);
    expect(below.json().message).toContain('(4)');
  });

  it('finished: nothing changes', async () => {
    const p = await newPlatform();
    const owner = await p.cookie('owner');
    const league = await createLeague(p, owner, { publish: true });
    await moveLeague(league.id, inDays(-9), inDays(-2), 'finished');
    expect((await call('PATCH', `/admin/leagues/${league.id}`, owner, { name: 'Sonradan' })).statusCode).toBe(
      409,
    );
    expect(
      (await call('PATCH', `/admin/leagues/${league.id}`, owner, { endsAt: inDays(5) })).statusCode,
    ).toBe(409);
    expect((await call('DELETE', `/admin/leagues/${league.id}`, owner)).statusCode).toBe(409);
  });

  it('deletes an empty draft and records every change with old and new values', async () => {
    const p = await newPlatform();
    const owner = await p.cookie('owner');
    const league = await createLeague(p, owner);
    await call('PATCH', `/admin/leagues/${league.id}`, owner, { startingCash: '250000', name: 'Denemelik' });
    expect((await call('DELETE', `/admin/leagues/${league.id}`, owner)).statusCode).toBe(204);
    expect((await call('GET', `/admin/leagues/${league.id}`, owner)).statusCode).toBe(404);

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.chainKey, p.tenantId))
      .orderBy(auditEvents.seq);
    expect(events.map((e) => e.action)).toEqual(['league.created', 'league.updated', 'league.deleted']);
    expect(events[1]?.metadata).toMatchObject({
      nameFrom: 'Kasım Ligi',
      nameTo: 'Denemelik',
      startingCashFrom: '100000.00',
      startingCashTo: '250000',
    });
    expect((await verifyAuditChain(db, p.tenantId)).ok).toBe(true);
  });

  it('never leaves a member with an old starting balance when the balance changes during joins', async () => {
    const p = await newPlatform();
    const owner = await p.cookie('owner');
    // Katılımlar PATCH'e göre farklı anlarda başlar; yarış penceresi turdan tura kayar.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let round = 0; round < 12; round++) {
      const league = await createLeague(p, owner, { publish: true, name: `Yarış ${round}` });
      const [patch] = await Promise.all([
        call('PATCH', `/admin/leagues/${league.id}`, owner, { startingCash: '777000' }),
        ...Array.from({ length: 5 }, (_, i) =>
          sleep(round * 2 + i * 3).then(() => addMember(p.tenantId, league.id)),
        ),
      ]);
      expect([200, 409]).toContain(patch.statusCode);
      const [final] = await db
        .select({ cash: leagues.startingCash })
        .from(leagues)
        .where(eq(leagues.id, league.id));
      const rows = await db
        .select({ cash: memberships.cash })
        .from(memberships)
        .where(eq(memberships.leagueId, league.id));
      expect(rows.length).toBe(5);
      expect(rows.every((r) => r.cash === final!.cash)).toBe(true);
    }
  });
});

describe('compliance settings (FR-24)', () => {
  it('shows locked settings to everyone, lets only the owner switch adjustable ones, and enforces them', async () => {
    const p = await newPlatform();
    const owner = await p.cookie('owner');
    const viewer = await p.cookie('viewer');
    await db
      .update(tenants)
      .set({ realTradeUrl: 'https://platform.test/trade' })
      .where(eq(tenants.id, p.tenantId));
    await db.insert(quests).values([
      { tenantId: p.tenantId, template: 'real_trade', period: 'weekly', targetCount: 1, xpReward: 250 },
      { tenantId: p.tenantId, template: 'place_orders', period: 'weekly', targetCount: 5, xpReward: 100 },
    ]);

    const view = await call('GET', '/admin/compliance', viewer);
    expect(view.statusCode).toBe(200);
    expect(view.json().locked.map((s: { key: string; enabled: boolean }) => [s.key, s.enabled])).toEqual([
      ['personalized_trade_advice', false],
      ['cash_rewards', false],
      ['wagering_mechanics', false],
      ['virtual_money_disclaimer', true],
    ]);
    expect(view.json().adjustable).toEqual({ realTradeButton: true, realTradeQuest: true });

    expect((await call('PATCH', '/admin/compliance', viewer, { realTradeQuest: false })).statusCode).toBe(
      403,
    );
    for (const locked of [{ cashRewards: true }, { personalized_trade_advice: true }, { locked: [] }]) {
      expect((await call('PATCH', '/admin/compliance', owner, locked)).statusCode).toBe(400);
    }

    const off = await call('PATCH', '/admin/compliance', owner, {
      realTradeQuest: false,
      realTradeButton: false,
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().adjustable).toEqual({ realTradeButton: false, realTradeQuest: false });

    const active = await questStore.listActive(db, p.tenantId);
    expect(active.map((q) => q.template)).toEqual(['place_orders']);
    expect(await new DrizzleTenantDirectory(db).findPublicInfo(p.tenantId)).toMatchObject({
      realTradeUrl: null,
    });

    // Aynı değeri tekrar göndermek kayıt üretmez.
    await call('PATCH', '/admin/compliance', owner, { realTradeQuest: false });
    await call('PATCH', '/admin/compliance', owner, { realTradeButton: true });
    expect(await new DrizzleTenantDirectory(db).findPublicInfo(p.tenantId)).toMatchObject({
      realTradeUrl: 'https://platform.test/trade',
    });
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.chainKey, p.tenantId))
      .orderBy(auditEvents.seq);
    expect(events.map((e) => e.action)).toEqual(['compliance.changed', 'compliance.changed']);
    expect(events[0]?.metadata).toEqual({
      realTradeButtonFrom: true,
      realTradeButtonTo: false,
      realTradeQuestFrom: true,
      realTradeQuestTo: false,
    });
  });
});
