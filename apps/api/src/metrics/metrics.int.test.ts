import { randomUUID } from 'node:crypto';
import {
  ADMIN_SESSION_COOKIE_NAME,
  type AdminRole,
  type MetricsResponse,
  SESSION_COOKIE_NAME,
} from '@lig/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import { configureApp } from '../app.setup';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SESSION_STORE, type SessionStore } from '../auth/ports';
import { ConfigModule } from '../config/config.module';
import { DB, DbModule, type Database } from '../db/db.module';
import {
  adminUsers,
  assets,
  leagues,
  memberships,
  platformEvents,
  players,
  questProgress,
  quests,
  realTradeClicks,
  virtualOrders,
  xpLedger,
} from '../db/schema';
import { RedisModule } from '../redis/redis.module';
import { SecretsModule } from '../secrets/secrets.module';
import { createTenant, deleteTenants } from '../test/integration.test-utils';
import { MetricsModule } from './metrics.module';

/** Metrikler (FR-23), HTTP üzerinden gerçek PostgreSQL ve Redis ile. */
let app: NestFastifyApplication;
let db: Database;
let auth: AdminAuthService;
let sessions: SessionStore;
const tenantIds: string[] = [];

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);

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
      MetricsModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app, { webOrigin: 'http://localhost:3000' });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = app.get(DB);
  auth = app.get(AdminAuthService);
  sessions = app.get(SESSION_STORE);
});

afterAll(async () => {
  await deleteTenants(db, tenantIds);
  await app.close();
});

async function newPlatform() {
  const tenantId = await createTenant(db, 'metrics');
  tenantIds.push(tenantId);

  const adminCookie = async (role: AdminRole) => {
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

  const newPlayer = async (externalId = randomUUID()) => {
    const [player] = await db
      .insert(players)
      .values({ tenantId, externalId, displayName: 'Oyuncu' })
      .returning({ id: players.id });
    return { id: player!.id, externalId };
  };

  const playerCookie = async (playerId: string) => ({
    [SESSION_COOKIE_NAME]: await sessions.create({ tenantId, playerId, createdAt: Date.now() }, 3600),
  });

  const newLeague = async (name = 'Lig', assetIds: string[] = []) => {
    const [league] = await db
      .insert(leagues)
      .values({
        tenantId,
        name,
        assetIds,
        type: 'weekly',
        status: 'active',
        startsAt: ago(3 * DAY),
        endsAt: new Date(Date.now() + 4 * DAY),
        startingCash: '100000.00',
      })
      .returning({ id: leagues.id });
    return league!.id;
  };

  const join = async (leagueId: string, playerId: string, joinedAt = new Date()) => {
    const [row] = await db
      .insert(memberships)
      .values({ leagueId, playerId, cash: '100000.00', joinedAt })
      .returning({ id: memberships.id });
    return row!.id;
  };

  const newAsset = async () => {
    const [asset] = await db
      .insert(assets)
      .values({ tenantId, symbol: `T${randomUUID().slice(0, 6)}`, name: 'Test', assetClass: 'crypto' })
      .returning({ id: assets.id });
    return asset!.id;
  };

  const placeOrder = async (membershipId: string, assetId: string, createdAt = new Date()) => {
    await db.insert(virtualOrders).values({
      membershipId,
      assetId,
      side: 'buy',
      amount: '100.00',
      price: '10.0000000000',
      quantity: '10.0000000000',
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      createdAt,
    });
  };

  const realTradeEvent = async (
    externalPlayerId: string,
    playerId: string | null,
    occurredAt = new Date(),
  ) => {
    await db.insert(platformEvents).values({
      tenantId,
      externalEventId: randomUUID(),
      externalPlayerId,
      playerId,
      type: 'real_trade',
      occurredAt,
    });
  };

  return {
    tenantId,
    adminCookie,
    newPlayer,
    playerCookie,
    newLeague,
    join,
    newAsset,
    placeOrder,
    realTradeEvent,
  };
}

const get = (url: string, cookies: Record<string, string>) => app.inject({ method: 'GET', url, cookies });

const report = async (cookies: Record<string, string>, days = 30) => {
  const res = await get(`/admin/metrics?days=${days}`, cookies);
  expect(res.statusCode).toBe(200);
  return res.json<MetricsResponse>();
};

describe('metrics (FR-23)', () => {
  it('counts the funnel from joins to real trades', async () => {
    const p = await newPlatform();
    const viewer = await p.adminCookie('viewer');
    const leagueId = await p.newLeague('Metrik Ligi');
    const assetId = await p.newAsset();

    const active = await p.newPlayer();
    const membershipId = await p.join(leagueId, active.id);
    await p.placeOrder(membershipId, assetId);
    await p.placeOrder(membershipId, assetId);

    // Modülü açmış ama lige katılmamış oyuncu.
    const idle = await p.newPlayer();

    // Gerçek işlemler: lig oyuncusu, ligsiz oyuncu, modülü hiç açmamış kullanıcı.
    await p.realTradeEvent(active.externalId, active.id);
    await p.realTradeEvent(active.externalId, active.id);
    await p.realTradeEvent(idle.externalId, idle.id);
    await p.realTradeEvent('bilinmeyen-kullanici', null);

    // "Gerçek hesabıma geç" dokunuşu: oyuncunun kendi isteğiyle.
    const clicked = await app.inject({
      method: 'POST',
      url: '/real-trade/click',
      cookies: await p.playerCookie(active.id),
      payload: { leagueId },
    });
    expect(clicked.statusCode).toBe(204);

    const result = await report(viewer);
    expect(result.days).toBe(30);
    expect(result.totals).toMatchObject({
      players: 2,
      activePlayers: 1,
      joins: 1,
      orders: 2,
      realTradeClicks: 1,
      realTradeClickPlayers: 1,
      realTrades: 4,
      accountsOpened: 0,
    });
    // Kullanıcı sayısı, olay sayısı değil: aktif oyuncunun iki olayı tek kullanıcı sayılır.
    expect(result.realTradeBreakdown).toEqual({ leaguePlayers: 1, modulePlayers: 1, outsiders: 1 });
    expect(result.leagues).toEqual([
      { id: leagueId, name: 'Metrik Ligi', status: 'active', members: 1, orders: 2, realTradeClicks: 1 },
    ]);
  });

  it('counts quests, xp and only what falls inside the period', async () => {
    const p = await newPlatform();
    const owner = await p.adminCookie('owner');
    const leagueId = await p.newLeague();
    const assetId = await p.newAsset();
    const player = await p.newPlayer();
    const membershipId = await p.join(leagueId, player.id, ago(20 * DAY));

    await p.placeOrder(membershipId, assetId, ago(20 * DAY));
    await p.placeOrder(membershipId, assetId, ago(2 * DAY));
    await p.realTradeEvent(player.externalId, player.id, ago(20 * DAY));

    const [quest] = await db
      .insert(quests)
      .values({
        tenantId: p.tenantId,
        template: 'place_orders',
        period: 'weekly',
        targetCount: 1,
        xpReward: 40,
      })
      .returning({ id: quests.id });
    await db.insert(questProgress).values({
      playerId: player.id,
      questId: quest!.id,
      periodKey: '2026-W38',
      progress: 1,
      completedAt: ago(20 * DAY),
    });
    await db
      .insert(xpLedger)
      .values({ playerId: player.id, reason: 'quest', sourceId: `${quest!.id}:2026-W38`, amount: 40 });

    const month = await report(owner, 30);
    expect(month.totals).toMatchObject({ orders: 2, joins: 1, questsCompleted: 1, xpGranted: 40 });
    expect(month.realTradeBreakdown.leaguePlayers).toBe(1);

    // 7 günlük pencerede 20 gün önceki hiçbir şey görünmez; XP kaydı bugün yazıldığı için sayılır.
    const week = await report(owner, 7);
    expect(week.totals).toMatchObject({ orders: 1, joins: 0, questsCompleted: 0, realTrades: 0 });
    expect(week.realTradeBreakdown).toEqual({ leaguePlayers: 0, modulePlayers: 0, outsiders: 0 });
    expect(week.totals.activePlayers).toBe(1);
    expect(new Date(week.since).getTime()).toBeLessThan(new Date(week.generatedAt).getTime());
  });

  it('keeps platforms apart and rejects unknown periods', async () => {
    const a = await newPlatform();
    const b = await newPlatform();
    const leagueId = await a.newLeague('A ligi');
    const assetId = await a.newAsset();
    const player = await a.newPlayer();
    const membershipId = await a.join(leagueId, player.id);
    await a.placeOrder(membershipId, assetId);
    await a.realTradeEvent(player.externalId, player.id);

    const other = await report(await b.adminCookie('owner'));
    expect(other.totals).toMatchObject({ players: 0, orders: 0, joins: 0, realTrades: 0 });
    expect(other.realTradeBreakdown).toEqual({ leaguePlayers: 0, modulePlayers: 0, outsiders: 0 });
    expect(other.leagues).toEqual([]);

    const owner = await a.adminCookie('owner');
    for (const bad of ['days=1', 'days=abc', 'days=30&extra=1']) {
      expect((await get(`/admin/metrics?${bad}`, owner)).statusCode, bad).toBe(400);
    }
    // Dönem verilmezse varsayılan 30 gün.
    expect((await report(owner, undefined as unknown as number)).days).toBeDefined();
    expect((await get('/admin/metrics', owner)).json<MetricsResponse>().days).toBe(30);
    expect((await get('/admin/metrics', {})).statusCode).toBe(401);
  });

  it('only counts a click for a league the player belongs to', async () => {
    const p = await newPlatform();
    const own = await p.newLeague('Kendi ligi');
    const foreign = await p.newLeague('Başkasının ligi');
    const player = await p.newPlayer();
    await p.join(own, player.id);
    // Başka bir oyuncu o ligin üyesi: üyelik kontrolü oyuncuya değil yalnızca lige bakarsa test bunu yakalar.
    const stranger = await p.newPlayer();
    await p.join(foreign, stranger.id);
    const cookies = await p.playerCookie(player.id);

    // Üye olmadığı lig: tıklama kaydedilir ama lige yazılmaz.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/real-trade/click',
          cookies,
          payload: { leagueId: foreign },
        })
      ).statusCode,
    ).toBe(204);
    // Ana ekrandan gelen tıklamada lig yok.
    await app.inject({ method: 'POST', url: '/real-trade/click', cookies, payload: {} });
    await app.inject({ method: 'POST', url: '/real-trade/click', cookies, payload: { leagueId: own } });

    const rows = await db.select().from(realTradeClicks).where(eq(realTradeClicks.playerId, player.id));
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.leagueId === own)).toHaveLength(1);
    expect(rows.filter((r) => r.leagueId === null)).toHaveLength(2);

    // Oturumsuz ve bozuk gövde.
    expect((await app.inject({ method: 'POST', url: '/real-trade/click', payload: {} })).statusCode).toBe(
      401,
    );
    expect(
      (await app.inject({ method: 'POST', url: '/real-trade/click', cookies, payload: { leagueId: 'x' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/real-trade/click',
          cookies,
          payload: { leagueId: own, url: 'https://evil.test' },
        })
      ).statusCode,
    ).toBe(400);

    const result = await report(await p.adminCookie('viewer'));
    expect(result.totals).toMatchObject({ realTradeClicks: 3, realTradeClickPlayers: 1 });
    expect(result.leagues.find((l) => l.id === own)?.realTradeClicks).toBe(1);
    expect(result.leagues.find((l) => l.id === foreign)?.realTradeClicks).toBe(0);
  });
});
