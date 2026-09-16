import { MAX_PRICE_AGE_MS, SESSION_COOKIE_NAME } from '@lig/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../app.setup';
import { InMemorySessionStore } from '../auth/fakes.test-utils';
import { SESSION_STORE } from '../auth/ports';
import { SessionGuard } from '../auth/session.guard';
import { CLOCK_MS } from '../common/clock';
import { InMemoryPriceStore } from '../prices/fakes.test-utils';
import { PRICE_STORE } from '../prices/ports';
import { PriceService } from '../prices/price.service';
import { InMemoryLeagueRepository, type StoredLeague } from './fakes.test-utils';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';
import { LEAGUE_REPOSITORY } from './ports';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2027-01-14T12:00:00Z');

let app: NestFastifyApplication;
let repo: InMemoryLeagueRepository;
let priceStore: InMemoryPriceStore;
let sessions: InMemorySessionStore;

let running: StoredLeague;
let upcoming: StoredLeague;
let ended: StoredLeague;
let draft: StoredLeague;
let otherTenant: StoredLeague;
let playerA: string;
let cookieA: Record<string, string>;
let cookieB: Record<string, string>;

async function sessionCookie(tenantId: string, playerId: string) {
  const token = await sessions.create({ tenantId, playerId, createdAt: 0 });
  return { [SESSION_COOKIE_NAME]: token };
}

beforeEach(async () => {
  repo = new InMemoryLeagueRepository();
  priceStore = new InMemoryPriceStore();
  sessions = new InMemorySessionStore();

  const btc = repo.addAsset(TENANT_A, 'BTC');
  const eth = repo.addAsset(TENANT_A, 'ETH');
  const foreignAsset = repo.addAsset(TENANT_B, 'BTC');

  running = repo.addLeague({
    tenantId: TENANT_A,
    name: 'Haftalık',
    startsAt: new Date('2027-01-11T00:00:00Z'),
    endsAt: new Date('2027-01-18T00:00:00Z'),
    // Başka tenant'ın varlık kimliği lig kaydına karışsa bile oyuncuya gösterilmemeli.
    assetIds: [eth.id, btc.id, foreignAsset.id],
  });
  upcoming = repo.addLeague({
    tenantId: TENANT_A,
    name: 'Gelecek',
    startsAt: new Date('2027-01-18T00:00:00Z'),
    endsAt: new Date('2027-01-25T00:00:00Z'),
  });
  ended = repo.addLeague({
    tenantId: TENANT_A,
    name: 'Biten',
    status: 'active',
    startsAt: new Date('2027-01-04T00:00:00Z'),
    endsAt: new Date('2027-01-11T00:00:00Z'),
  });
  draft = repo.addLeague({ tenantId: TENANT_A, name: 'Taslak', status: 'draft' });
  repo.addLeague({ tenantId: TENANT_A, name: 'Arkadaş', type: 'friends' });
  otherTenant = repo.addLeague({ tenantId: TENANT_B, name: 'B platformu' });

  playerA = repo.addPlayer(TENANT_A);
  const playerB = repo.addPlayer(TENANT_B);
  cookieA = await sessionCookie(TENANT_A, playerA);
  cookieB = await sessionCookie(TENANT_B, playerB);

  const moduleRef = await Test.createTestingModule({
    controllers: [LeaguesController],
    providers: [
      LeaguesService,
      PriceService,
      SessionGuard,
      { provide: CLOCK_MS, useValue: () => NOW.getTime() },
      { provide: LEAGUE_REPOSITORY, useValue: repo },
      { provide: PRICE_STORE, useValue: priceStore },
      { provide: SESSION_STORE, useValue: sessions },
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app, { webOrigin: 'http://localhost:3000' });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterEach(async () => {
  await app.close();
});

const get = (url: string, cookies = cookieA) => app.inject({ method: 'GET', url, cookies });
const join = (leagueId: string, cookies = cookieA) =>
  app.inject({ method: 'POST', url: `/leagues/${leagueId}/join`, cookies });

describe('authentication', () => {
  it.each([
    ['GET', '/leagues'],
    ['GET', `/leagues/${TENANT_A}`],
    ['GET', `/leagues/${TENANT_A}/prices`],
    ['POST', `/leagues/${TENANT_A}/join`],
  ] as const)('%s %s requires a session', async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /leagues (FR-02)', () => {
  it('lists only visible leagues of the player tenant, running first', async () => {
    const res = await get('/leagues');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');

    const leagues = res.json<{ leagues: Array<{ name: string; phase: string }> }>().leagues;
    expect(leagues.map((l) => [l.name, l.phase])).toEqual([
      ['Haftalık', 'running'],
      ['Gelecek', 'upcoming'],
      ['Biten', 'ended'],
    ]);
  });

  it('never shows another tenant its leagues (T4)', async () => {
    const names = (await get('/leagues', cookieB)).json<{ leagues: Array<{ name: string }> }>().leagues;
    expect(names.map((l) => l.name)).toEqual(['B platformu']);
  });

  it('reports member count and whether the player joined', async () => {
    await join(running.id);
    const [first] = (await get('/leagues')).json<{
      leagues: Array<{ memberCount: number; joined: boolean }>;
    }>().leagues;
    expect(first).toMatchObject({ memberCount: 1, joined: true });
  });
});

describe('GET /leagues/:id', () => {
  it('returns assets in league order with latest prices, excluding foreign assets', async () => {
    await priceStore.saveIfNewer(TENANT_A, [
      { symbol: 'BTC', price: '4000000.00', timestamp: NOW.getTime() - 1_000 },
      { symbol: 'ETH', price: '150000.00', timestamp: NOW.getTime() - MAX_PRICE_AGE_MS - 1 },
    ]);
    await priceStore.saveIfNewer(TENANT_B, [{ symbol: 'BTC', price: '1.00', timestamp: NOW.getTime() }]);

    const res = await get(`/leagues/${running.id}`);
    expect(res.statusCode).toBe(200);
    const { league } = res.json<{ league: Record<string, unknown> }>();
    expect(league).toMatchObject({
      name: 'Haftalık',
      phase: 'running',
      canJoin: true,
      membership: null,
      assets: [
        { symbol: 'ETH', price: '150000.00', stale: true },
        { symbol: 'BTC', price: '4000000.00', stale: false },
      ],
    });
    expect(league.assets).toHaveLength(2);
  });

  it.each([
    ['a draft league', () => draft.id],
    ["another tenant's league", () => otherTenant.id],
    ['a league that does not exist', () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
  ])('returns the same 404 for %s', async (_label, id) => {
    const res = await get(`/leagues/${id()}`);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'NOT_FOUND', message: 'Lig bulunamadı.' });
  });

  it('rejects a malformed league id', async () => {
    const res = await get("/leagues/1' OR '1'='1");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'VALIDATION_FAILED', message: 'Geçersiz alanlar: leagueId' });
  });

  it('exposes membership cash after joining', async () => {
    await join(running.id);
    const { league } = (await get(`/leagues/${running.id}`)).json<{
      league: { canJoin: boolean; joined: boolean; membership: { cash: string } };
    }>();
    expect(league).toMatchObject({ joined: true, canJoin: false, membership: { cash: '100000.00' } });
  });
});

describe('GET /leagues/:id/prices', () => {
  it('returns only prices, marking missing ones as stale', async () => {
    const res = await get(`/leagues/${running.id}/prices`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      prices: [
        expect.objectContaining({ symbol: 'ETH', price: null, stale: true }),
        expect.objectContaining({ symbol: 'BTC', price: null, stale: true }),
      ],
    });
  });
});

describe('POST /leagues/:id/join (FR-03)', () => {
  it('creates a membership with the starting cash', async () => {
    const res = await join(running.id);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      created: true,
      membership: { cash: '100000.00', joinedAt: NOW.toISOString() },
    });
  });

  it('allows joining an upcoming league', async () => {
    expect((await join(upcoming.id)).statusCode).toBe(201);
  });

  it('is idempotent: joining again returns the same membership without new cash', async () => {
    await join(running.id);
    const again = await join(running.id);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ created: false, membership: { cash: '100000.00' } });
    expect(repo.memberships).toHaveLength(1);
  });

  it('rejects joining an ended league', async () => {
    const res = await join(ended.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'LEAGUE_NOT_ACTIVE' });
  });

  it("cannot join another tenant's league or a draft (T4)", async () => {
    expect((await join(otherTenant.id)).statusCode).toBe(404);
    expect((await join(draft.id)).statusCode).toBe(404);
    expect(repo.memberships).toHaveLength(0);
  });

  it('ignores any cash the client tries to send', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/leagues/${running.id}/join`,
      cookies: cookieA,
      payload: { cash: '999999999' },
    });
    expect(res.json()).toMatchObject({ membership: { cash: '100000.00' } });
  });
});
