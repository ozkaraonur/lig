import { randomUUID } from 'node:crypto';
import { MAX_PRICE_AGE_MS, SESSION_COOKIE_NAME } from '@lig/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../app.setup';
import { InMemoryRateLimiter, InMemorySessionStore } from '../auth/fakes.test-utils';
import { PlayerRateLimitGuard, RATE_LIMITS } from '../auth/player-rate-limit.guard';
import { RATE_LIMITER, SESSION_STORE } from '../auth/ports';
import { SessionGuard } from '../auth/session.guard';
import { CLOCK_MS } from '../common/clock';
import { InMemoryLeagueRepository, type StoredLeague } from '../leagues/fakes.test-utils';
import { LEAGUE_REPOSITORY } from '../leagues/ports';
import { InMemoryPriceStore } from '../prices/fakes.test-utils';
import { PRICE_STORE } from '../prices/ports';
import { PriceService } from '../prices/price.service';
import { InMemoryOrders } from './fakes.test-utils';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PortfolioService } from './portfolio.service';
import { ORDER_UNIT_OF_WORK, PORTFOLIO_READER } from './ports';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const START = new Date('2027-01-14T12:00:00Z').getTime();

let now: number;
let app: NestFastifyApplication;
let repo: InMemoryLeagueRepository;
let orders: InMemoryOrders;
let prices: InMemoryPriceStore;
let sessions: InMemorySessionStore;

let running: StoredLeague;
let btc: { id: string };
let eth: { id: string };
let sol: { id: string };
let foreignAsset: { id: string };
let playerA: string;
let cookieA: Record<string, string>;
let cookieOutsider: Record<string, string>;
let cookieB: Record<string, string>;

const day = 24 * 60 * 60 * 1000;

async function cookieFor(tenantId: string, playerId: string) {
  return { [SESSION_COOKIE_NAME]: await sessions.create({ tenantId, playerId, createdAt: 0 }) };
}

function member(league: StoredLeague, playerId: string, cash = league.startingCash) {
  repo.memberships.push({ id: randomUUID(), leagueId: league.id, playerId, cash, joinedAt: new Date(now) });
}

async function setPrice(symbol: string, price: string, ageMs = 1_000) {
  await prices.saveIfNewer(TENANT_A, [{ symbol, price, timestamp: now - ageMs }]);
}

beforeEach(async () => {
  now = START;
  repo = new InMemoryLeagueRepository();
  orders = new InMemoryOrders(repo, () => new Date(now));
  prices = new InMemoryPriceStore();
  sessions = new InMemorySessionStore();

  btc = repo.addAsset(TENANT_A, 'BTC');
  eth = repo.addAsset(TENANT_A, 'ETH');
  sol = repo.addAsset(TENANT_A, 'SOL');
  foreignAsset = repo.addAsset(TENANT_B, 'XRP');

  running = repo.addLeague({
    tenantId: TENANT_A,
    startsAt: new Date(START - 3 * day),
    endsAt: new Date(START + 4 * day),
    startingCash: '100000.00',
    assetIds: [btc.id, eth.id, foreignAsset.id],
  });

  playerA = repo.addPlayer(TENANT_A);
  const outsider = repo.addPlayer(TENANT_A);
  const playerB = repo.addPlayer(TENANT_B);
  member(running, playerA);
  cookieA = await cookieFor(TENANT_A, playerA);
  cookieOutsider = await cookieFor(TENANT_A, outsider);
  cookieB = await cookieFor(TENANT_B, playerB);

  await setPrice('BTC', '1000');
  await setPrice('ETH', '50', MAX_PRICE_AGE_MS + 1);

  const moduleRef = await Test.createTestingModule({
    controllers: [OrdersController],
    providers: [
      OrdersService,
      PortfolioService,
      PriceService,
      SessionGuard,
      PlayerRateLimitGuard,
      { provide: CLOCK_MS, useValue: () => now },
      { provide: LEAGUE_REPOSITORY, useValue: repo },
      { provide: ORDER_UNIT_OF_WORK, useValue: orders },
      { provide: PORTFOLIO_READER, useValue: orders },
      { provide: PRICE_STORE, useValue: prices },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: RATE_LIMITER, useValue: new InMemoryRateLimiter() },
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

type Body = Record<string, unknown>;

const buy = (amount: string, extra: Body = {}): Body => ({
  assetId: btc.id,
  side: 'buy',
  amount,
  idempotencyKey: randomUUID(),
  ...extra,
});
const sell = (amount: string, extra: Body = {}): Body => ({ ...buy(amount), side: 'sell', ...extra });
const sellAll = (extra: Body = {}): Body => ({
  assetId: btc.id,
  side: 'sell',
  all: true,
  idempotencyKey: randomUUID(),
  ...extra,
});

function order(payload: Body, { leagueId = running.id, cookies = cookieA } = {}) {
  return app.inject({ method: 'POST', url: `/leagues/${leagueId}/orders`, payload, cookies });
}

const cashOf = (playerId = playerA, league = running) =>
  repo.memberships.find((m) => m.playerId === playerId && m.leagueId === league.id)!.cash;

function expectError(res: { statusCode: number; json: () => unknown }, status: number, code: string) {
  expect({ status: res.statusCode, body: res.json() }).toMatchObject({ status, body: { code } });
}

describe('authentication and validation', () => {
  it.each([
    ['POST', 'orders'],
    ['GET', 'orders'],
    ['GET', 'portfolio'],
  ] as const)('%s %s requires a session', async (method, path) => {
    const res = await app.inject({ method, url: `/leagues/${TENANT_A}/${path}`, payload: buy('1') });
    expect(res.statusCode).toBe(401);
  });

  it.each([
    ['missing idempotency key', { idempotencyKey: undefined }],
    ['client supplied price', { price: '0.01' }],
    ['client supplied quantity', { quantity: '999' }],
    ['scientific notation', { amount: '1e5' }],
    ['negative amount', { amount: '-100' }],
    ['three decimals', { amount: '1.001' }],
    ['unknown side', { side: 'short' }],
  ])('rejects %s with 400', async (_label, override) => {
    const res = await order(buy('100', override));
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(orders.orders).toHaveLength(0);
  });
});

describe('activity diagram branches (FR-04)', () => {
  it.each([
    ['a draft league', () => repo.addLeague({ tenantId: TENANT_A, status: 'draft' }).id],
    ["another tenant's league", () => repo.addLeague({ tenantId: TENANT_B }).id],
    ['a missing league', () => randomUUID()],
  ])('404 for %s', async (_label, leagueId) => {
    expectError(await order(buy('100'), { leagueId: leagueId() }), 404, 'NOT_FOUND');
  });

  it('403 NOT_A_MEMBER when the player has not joined', async () => {
    expectError(await order(buy('100'), { cookies: cookieOutsider }), 403, 'NOT_A_MEMBER');
  });

  it.each([
    ['has not started', { startsAt: new Date(START + day), endsAt: new Date(START + 7 * day) }],
    ['has ended but is not closed yet', { startsAt: new Date(START - 7 * day), endsAt: new Date(START) }],
    ['was finished by an admin', { status: 'finished' as const }],
  ])('409 LEAGUE_NOT_ACTIVE when the league %s', async (_label, override) => {
    const league = repo.addLeague({
      tenantId: TENANT_A,
      startsAt: new Date(START - day),
      endsAt: new Date(START + day),
      assetIds: [btc.id],
      ...override,
    });
    member(league, playerA);
    expectError(await order(buy('100'), { leagueId: league.id }), 409, 'LEAGUE_NOT_ACTIVE');
  });

  it.each([
    ['a tenant asset outside the league', () => sol.id],
    ["another tenant's asset listed in the league", () => foreignAsset.id],
    ['an unknown asset', () => randomUUID()],
  ])('422 ASSET_NOT_IN_LEAGUE for %s', async (_label, assetId) => {
    expectError(await order(buy('100', { assetId: assetId() })), 422, 'ASSET_NOT_IN_LEAGUE');
  });

  it('409 PRICE_STALE when the last price is older than the limit (T2)', async () => {
    const res = await order(buy('100', { assetId: eth.id }));
    expectError(res, 409, 'PRICE_STALE');
    expect(res.headers['retry-after']).toBe('2');
  });

  it('409 PRICE_STALE when there has never been a price', async () => {
    repo.leagues.find((l) => l.id === running.id)!.assetIds.push(sol.id);
    expectError(await order(buy('100', { assetId: sol.id })), 409, 'PRICE_STALE');
  });

  it('prices become stale as time passes without a new tick', async () => {
    now += MAX_PRICE_AGE_MS;
    expectError(await order(buy('100')), 409, 'PRICE_STALE');
  });

  it('422 INSUFFICIENT_CASH for one kuruş more than the balance', async () => {
    expectError(await order(buy('100000.01')), 422, 'INSUFFICIENT_CASH');
    expect(cashOf()).toBe('100000.00');
  });

  it('allows spending the exact balance down to zero', async () => {
    const res = await order(buy('100000.00'));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ cash: '0.00', position: { quantity: '100.0000000000' } });
  });

  it('422 ORDER_TOO_SMALL when the amount buys zero units', async () => {
    await setPrice('BTC', '999999999999999999', 0);
    expectError(await order(buy('0.01')), 422, 'ORDER_TOO_SMALL');
  });

  it.each([
    ['selling by amount without a position', () => sell('100')],
    ['selling all without a position', () => sellAll()],
  ])('422 NO_POSITION when %s', async (_label, body) => {
    expectError(await order(body()), 422, 'NO_POSITION');
  });

  it('422 NO_POSITION when selling more than held', async () => {
    await order(buy('1000'));
    expectError(await order(sell('1000.01')), 422, 'NO_POSITION');
  });
});

describe('successful orders', () => {
  it('buys at the server price and returns balance and position', async () => {
    const res = await order(buy('2500'));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      replayed: false,
      order: {
        side: 'buy',
        symbol: 'BTC',
        amount: '2500.00',
        price: '1000.0000000000',
        quantity: '2.5000000000',
      },
      cash: '97500.00',
      position: { assetId: btc.id, quantity: '2.5000000000', avgCost: '1000.0000000000' },
    });
    expect(cashOf()).toBe('97500.00');
  });

  it('averages cost across buys at different prices', async () => {
    await order(buy('1000'));
    await setPrice('BTC', '2000', 0);
    const res = await order(buy('1000'));
    expect(res.json()).toMatchObject({ position: { quantity: '1.5000000000', avgCost: '1333.3333333334' } });
  });

  it('sells by amount, keeping the average cost', async () => {
    await order(buy('3000'));
    await setPrice('BTC', '1500', 0);
    const res = await order(sell('1500'));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      cash: '98500.00',
      position: { quantity: '2.0000000000', avgCost: '1000.0000000000' },
    });
  });

  it('sells the whole position and removes it', async () => {
    await order(buy('3000'));
    await setPrice('BTC', '1100', 0);
    const res = await order(sellAll());
    expect(res.json()).toMatchObject({ order: { amount: '3300.00' }, cash: '100300.00', position: null });
    expect(orders.positions).toHaveLength(0);
  });

  it('records exactly one quest event per filled order, none for rejected or replayed ones (FR-07)', async () => {
    const body = buy('1000');
    await order(body);
    await order(body); // tekrar
    await order(buy('999999')); // yetersiz bakiye
    expect(orders.events).toEqual([{ tenantId: TENANT_A, playerId: playerA, type: 'order_placed' }]);
  });

  it('rolls everything back if saving the order fails', async () => {
    orders.failNextInsert = true;
    const res = await order(buy('5000'));
    expectError(res, 500, 'INTERNAL');
    expect(cashOf()).toBe('100000.00');
    expect(orders.positions).toHaveLength(0);
    expect(orders.events).toHaveLength(0);
  });
});

describe('idempotency (FR-33)', () => {
  it('returns the original result for a retried request without charging twice', async () => {
    const body = buy('1000');
    const first = await order(body);
    const retry = await order(body);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({
      replayed: true,
      order: { id: first.json<{ order: { id: string } }>().order.id },
    });
    expect(orders.orders).toHaveLength(1);
    expect(cashOf()).toBe('99000.00');
  });

  it('rejects the same key with a different order', async () => {
    const body = buy('1000');
    await order(body);
    expectError(await order({ ...body, amount: '2000' }), 409, 'IDEMPOTENCY_KEY_REUSED');
    expectError(await order({ ...body, side: 'sell' }), 409, 'IDEMPOTENCY_KEY_REUSED');
    expect(orders.orders).toHaveLength(1);
  });

  it('does not burn the key when the order was rejected', async () => {
    const key = randomUUID();
    expectError(await order(buy('200000', { idempotencyKey: key })), 422, 'INSUFFICIENT_CASH');
    expect((await order(buy('1000', { idempotencyKey: key }))).statusCode).toBe(201);
  });

  it('still replays after the league has ended', async () => {
    const body = buy('1000');
    await order(body);
    now = running.endsAt.getTime() + 1;
    expect((await order(body)).statusCode).toBe(200);
  });

  it('keys are scoped per membership: another player may use the same key', async () => {
    const other = repo.addPlayer(TENANT_A);
    member(running, other);
    const body = buy('1000');
    await order(body);
    expect((await order(body, { cookies: await cookieFor(TENANT_A, other) })).statusCode).toBe(201);
  });
});

describe('anti-cheat (T2, T3)', () => {
  it('parallel buys can never spend more than the balance', async () => {
    // Rate limit dışında kalmak için ikinci bir oyuncuya ihtiyaç yok: 20 < 30.
    const results = await Promise.all(Array.from({ length: 20 }, () => order(buy('10000'))));
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(10);
    expect(codes.filter((c) => c === 422)).toHaveLength(10);
    expect(cashOf()).toBe('0.00');
  });

  it('cannot sell the same position twice in parallel', async () => {
    await order(buy('1000'));
    const results = await Promise.all([order(sellAll()), order(sellAll()), order(sell('1000'))]);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(cashOf()).toBe('100000.00');
  });

  it('a player cannot trade in another player membership by guessing ids (T4)', async () => {
    expectError(await order(buy('100'), { cookies: cookieB }), 404, 'NOT_FOUND');
    expect(cashOf()).toBe('100000.00');
  });
});

describe('GET portfolio (FR-05)', () => {
  const getPortfolio = (cookies = cookieA) =>
    app.inject({ method: 'GET', url: `/leagues/${running.id}/portfolio`, cookies });

  it('values positions at the latest price with profit and return', async () => {
    await order(buy('1000'));
    await setPrice('BTC', '1100', 0);

    const res = await getPortfolio();
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      portfolio: {
        cash: '99000.00',
        startingCash: '100000.00',
        positionsValue: '1100.00',
        totalValue: '100100.00',
        returnPercent: '0.10',
        positions: [
          {
            assetId: btc.id,
            symbol: 'BTC',
            name: 'BTC',
            quantity: '1.0000000000',
            avgCost: '1000.0000000000',
            price: '1100.0000000000',
            stale: false,
            value: '1100.00',
            pnl: '100.00',
            pnlPercent: '10.00',
          },
        ],
      },
    });
  });

  it('shows losses with a sign', async () => {
    await order(buy('1000'));
    await setPrice('BTC', '750', 0);
    expect((await getPortfolio()).json()).toMatchObject({
      portfolio: { returnPercent: '-0.25', positions: [{ pnl: '-250.00', pnlPercent: '-25.00' }] },
    });
  });

  it('keeps the last known price when it becomes stale', async () => {
    await order(buy('1000'));
    now += MAX_PRICE_AGE_MS + 1;
    expect((await getPortfolio()).json()).toMatchObject({
      portfolio: { totalValue: '100000.00', positions: [{ price: '1000.0000000000', stale: true }] },
    });
  });

  it('is only available to members of a visible league', async () => {
    expectError(await getPortfolio(cookieOutsider), 403, 'NOT_A_MEMBER');
    expectError(await getPortfolio(cookieB), 404, 'NOT_FOUND');
  });
});

describe('GET orders', () => {
  const history = (query = '') =>
    app.inject({ method: 'GET', url: `/leagues/${running.id}/orders${query}`, cookies: cookieA });

  it('lists the newest orders first, limited', async () => {
    await order(buy('100'));
    await order(buy('200'));
    await order(sell('50'));
    const res = await history('?limit=2');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ orders: Array<{ side: string; amount: string }> }>().orders).toEqual([
      expect.objectContaining({ side: 'sell', amount: '50.00' }),
      expect.objectContaining({ side: 'buy', amount: '200.00' }),
    ]);
  });

  it.each(['?limit=0', '?limit=101', '?limit=abc'])('rejects %s', async (query) => {
    expectError(await history(query), 400, 'VALIDATION_FAILED');
  });
});

describe('rate limiting (T9)', () => {
  it('limits orders per player per minute', async () => {
    for (let i = 0; i < RATE_LIMITS.orders.limit; i++) await order(buy('1'));
    const res = await order(buy('1'));
    expectError(res, 429, 'RATE_LIMITED');
    expect(orders.orders).toHaveLength(RATE_LIMITS.orders.limit);
  });
});
