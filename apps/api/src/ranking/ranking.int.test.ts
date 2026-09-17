import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type MsClock } from '../common/clock';
import { parseEnv } from '../config/env';
import { assets, leagues, memberships, players, xpLedger } from '../db/schema';
import { DrizzleLeagueRepository } from '../leagues/drizzle-league.repository';
import { DrizzleOrderUnitOfWork, DrizzlePortfolioReader } from '../orders/drizzle-orders';
import { OrdersService } from '../orders/orders.service';
import { PortfolioService } from '../orders/portfolio.service';
import { PriceService } from '../prices/price.service';
import { RedisPriceStore } from '../prices/redis-price.store';
import {
  connectIntegration,
  createTenant,
  deleteTenants,
  type IntegrationContext,
} from '../test/integration.test-utils';
import {
  DrizzleFinalStandingsReader,
  DrizzleLeagueCloseUnitOfWork,
  DrizzleRankingSource,
} from './drizzle-ranking';
import { LeagueCloseService } from './league-close.service';
import { LeagueSchedulerWorker } from './league-scheduler.worker';
import { RankingService } from './ranking.service';
import { rankingKey, RedisRankingStore } from './redis-ranking.store';

let ctx: IntegrationContext;
let tenantId: string;
let assetId: string;
let symbol: string;
let now: number;
const clock: MsClock = () => now;

let priceStore: RedisPriceStore;
let orders: OrdersService;
let ranking: RankingService;
let closer: LeagueCloseService;
let source: DrizzleRankingSource;
let store: RedisRankingStore;
let portfolios: PortfolioService;

const MIN = 60_000;

async function setPrice(price: string) {
  await ctx.redis.del(`price:${tenantId}:${symbol}`);
  await priceStore.saveIfNewer(tenantId, [{ symbol, price, timestamp: now }]);
}

async function createLeague(endsInMs = 10 * MIN) {
  const [league] = await ctx.db
    .insert(leagues)
    .values({
      tenantId,
      name: 'rank-int',
      type: 'weekly',
      status: 'active',
      startsAt: new Date(now - 10 * MIN),
      endsAt: new Date(now + endsInMs),
      startingCash: '1000.00',
      assetIds: [assetId],
    })
    .returning({ id: leagues.id });
  return league!.id;
}

async function join(leagueId: string, name: string) {
  const [player] = await ctx.db
    .insert(players)
    .values({ tenantId, externalId: randomUUID(), displayName: name })
    .returning({ id: players.id });
  await ctx.db.insert(memberships).values({ leagueId, playerId: player!.id, cash: '1000.00' });
  return { tenantId, playerId: player!.id, createdAt: 0 };
}

type Session = Awaited<ReturnType<typeof join>>;

const buy = (session: Session, leagueId: string, amount: string) =>
  orders.place(session, leagueId, { assetId, side: 'buy', amount, idempotencyKey: randomUUID() });

beforeAll(async () => {
  ctx = connectIntegration();
  now = Date.now();
  tenantId = await createTenant(ctx.db, 'ranking-int');
  symbol = `R${Date.now()}`.slice(0, 16);
  const [asset] = await ctx.db
    .insert(assets)
    .values({ tenantId, symbol, name: 'Rank coin', assetClass: 'crypto' })
    .returning({ id: assets.id });
  assetId = asset!.id;

  priceStore = new RedisPriceStore(ctx.redis);
  const prices = new PriceService(priceStore, clock);
  orders = new OrdersService(new DrizzleOrderUnitOfWork(ctx.db), prices, clock);
  source = new DrizzleRankingSource(ctx.db);
  store = new RedisRankingStore(ctx.redis);
  const finals = new DrizzleFinalStandingsReader(ctx.db);
  ranking = new RankingService(source, store, finals, new DrizzleLeagueRepository(ctx.db), prices, clock);
  portfolios = new PortfolioService(
    new DrizzleLeagueRepository(ctx.db),
    new DrizzlePortfolioReader(ctx.db),
    prices,
  );
  closer = new LeagueCloseService(new DrizzleLeagueCloseUnitOfWork(ctx.db), store, prices, clock);
});

beforeEach(async () => {
  now = Date.now();
  await setPrice('10');
});

afterAll(async () => {
  await ctx.redis.del(`price:${tenantId}:${symbol}`);
  await deleteTenants(ctx.db, [tenantId]);
  await ctx.close();
});

describe('live leaderboard (FR-06)', () => {
  it('ranks members by portfolio value at the latest price and shows my row', async () => {
    const leagueId = await createLeague();
    const ali = await join(leagueId, 'Ali');
    const bora = await join(leagueId, 'Bora');
    const cem = await join(leagueId, 'Cem');

    await buy(ali, leagueId, '1000'); // 100 adet
    await buy(bora, leagueId, '500'); // 50 adet + 500 nakit
    await setPrice('12'); // Ali 1200, Bora 1100, Cem 1000

    await ranking.recompute({ id: leagueId, tenantId });
    const board = await ranking.leaderboard(cem, leagueId, 2);

    expect(board).toMatchObject({
      final: false,
      playerCount: 3,
      top: [
        { rank: 1, displayName: 'Ali', totalValue: '1200.00', returnPercent: '20.00', isMe: false },
        { rank: 2, displayName: 'Bora', totalValue: '1100.00', returnPercent: '10.00', isMe: false },
      ],
      me: {
        rank: 3,
        displayName: 'Cem',
        totalValue: '1000.00',
        returnPercent: '0.00',
        isMe: true,
        xpAwarded: null,
      },
    });
    expect(board.updatedAt).not.toBeNull();
  });

  it('shares a rank between equal portfolios', async () => {
    const leagueId = await createLeague();
    const sessions = [await join(leagueId, 'A'), await join(leagueId, 'B'), await join(leagueId, 'C')];
    await buy(sessions[0]!, leagueId, '100');
    await setPrice('20'); // A: 900 + 10×20 = 1100, B ve C: 1000
    await ranking.recompute({ id: leagueId, tenantId });

    const board = await ranking.leaderboard(sessions[2]!, leagueId, 5);
    expect(board.top.map((e) => e.rank)).toEqual([1, 2, 2]);
    expect(board.me?.rank).toBe(2);
  });

  it('has no "me" row for a non-member and an empty board before the first calculation', async () => {
    const leagueId = await createLeague();
    const outsider = { tenantId, playerId: randomUUID(), createdAt: 0 };
    await join(leagueId, 'X');
    const before = await ranking.leaderboard(outsider, leagueId, 5);
    expect(before).toMatchObject({ top: [], me: null, playerCount: 0, updatedAt: null });
  });

  it('removes members that left from the ranking on the next calculation', async () => {
    const leagueId = await createLeague();
    const a = await join(leagueId, 'A');
    await join(leagueId, 'B');
    await ranking.recompute({ id: leagueId, tenantId });
    expect(await store.count(leagueId)).toBe(2);

    await ctx.db.delete(memberships).where(eq(memberships.playerId, a.playerId));
    await ranking.recompute({ id: leagueId, tenantId });
    expect(await store.count(leagueId)).toBe(1);
  });
});

describe('league close (FR-32)', () => {
  it('freezes standings, grants XP by the reward rules and closes the league', async () => {
    const leagueId = await createLeague(MIN);
    const heavyBuyer = await join(leagueId, 'Çok alan');
    const second = await join(leagueId, 'İkinci');
    const idle = await join(leagueId, 'Hiç işlem yapmayan');

    await buy(heavyBuyer, leagueId, '1000');
    await buy(second, leagueId, '10');
    await setPrice('5'); // Çok alan 500, İkinci 995, idle 1000 → idle birinci ama ödül almaz
    await ranking.recompute({ id: leagueId, tenantId });

    now += 2 * MIN;
    const result = await closer.close(leagueId);
    expect(result).toEqual({ closed: true, players: 3, xpGranted: 600 + 400 });

    const [league] = await ctx.db.select().from(leagues).where(eq(leagues.id, leagueId));
    expect(league).toMatchObject({ status: 'finished' });
    expect(league?.closedAt).toBeInstanceOf(Date);
    expect(await ctx.redis.exists(rankingKey(leagueId))).toBe(0);

    const xp = await ctx.db
      .select({ id: players.id, xp: players.xp })
      .from(players)
      .where(inArray(players.id, [heavyBuyer.playerId, second.playerId, idle.playerId]));
    const xpOf = new Map(xp.map((p) => [p.id, p.xp]));
    expect(xpOf.get(idle.playerId)).toBe(0);
    expect(xpOf.get(second.playerId)).toBe(600);
    expect(xpOf.get(heavyBuyer.playerId)).toBe(400);

    const board = await ranking.leaderboard(second, leagueId, 5);
    expect(board).toMatchObject({
      final: true,
      playerCount: 3,
      top: [
        { rank: 1, displayName: 'Hiç işlem yapmayan', totalValue: '1000.00' },
        { rank: 2, displayName: 'İkinci', totalValue: '995.00', isMe: true },
        { rank: 3, displayName: 'Çok alan', totalValue: '500.00', returnPercent: '-50.00' },
      ],
      me: { rank: 2, xpAwarded: 600 },
    });
  });

  it('keeps final standings and the portfolio screen identical when prices move afterwards', async () => {
    const leagueId = await createLeague(MIN);
    const p = await join(leagueId, 'P');
    await buy(p, leagueId, '1000');
    await setPrice('11');
    now += 2 * MIN;
    await closer.close(leagueId);

    await setPrice('999');
    const board = await ranking.leaderboard(p, leagueId, 5);
    expect(board.me?.totalValue).toBe('1100.00');

    const portfolio = await portfolios.portfolio(p, leagueId);
    expect(portfolio).toMatchObject({
      totalValue: '1100.00',
      positions: [{ price: '11.0000000000', stale: false }],
    });
  });

  it('refuses to close a league that has not ended', async () => {
    const leagueId = await createLeague(10 * MIN);
    expect(await closer.close(leagueId)).toEqual({ closed: false, reason: 'not_ended' });
  });

  it('closes exactly once when five closers race, and never grants XP twice', async () => {
    const leagueId = await createLeague(MIN);
    const p = await join(leagueId, 'Tek');
    await buy(p, leagueId, '100');
    now += 2 * MIN;

    const results = await Promise.all(Array.from({ length: 5 }, () => closer.close(leagueId)));
    expect(results.filter((r) => r.closed)).toHaveLength(1);
    expect(results.filter((r) => !r.closed).every((r) => !r.closed && r.reason === 'not_active')).toBe(true);

    const ledger = await ctx.db.select().from(xpLedger).where(eq(xpLedger.playerId, p.playerId));
    expect(ledger).toHaveLength(1);
    const [row] = await ctx.db.select({ xp: players.xp }).from(players).where(eq(players.id, p.playerId));
    expect(row?.xp).toBe(1000);
  });

  it('a re-run after a crash between ledger and status update cannot double-grant', async () => {
    const leagueId = await createLeague(MIN);
    const p = await join(leagueId, 'Tekrar');
    await buy(p, leagueId, '100');
    now += 2 * MIN;
    await closer.close(leagueId);

    // Kapanış sonrası durumu "yarıda kalmış" gibi geri al: lig tekrar aktif, XP defteri duruyor.
    await ctx.db.update(leagues).set({ status: 'active', closedAt: null }).where(eq(leagues.id, leagueId));
    const again = await closer.close(leagueId);
    expect(again).toMatchObject({ closed: true, xpGranted: 0 });
    const [row] = await ctx.db.select({ xp: players.xp }).from(players).where(eq(players.id, p.playerId));
    expect(row?.xp).toBe(1000);
  });

  it('rejects orders once the league has ended, before and after closing', async () => {
    const leagueId = await createLeague(MIN);
    const p = await join(leagueId, 'Geç kalan');
    now += 2 * MIN;
    await setPrice('10');
    await expect(buy(p, leagueId, '10')).rejects.toMatchObject({ code: 'LEAGUE_NOT_ACTIVE' });
    await closer.close(leagueId);
    await expect(buy(p, leagueId, '10')).rejects.toMatchObject({ code: 'LEAGUE_NOT_ACTIVE' });
  });
});

describe('LeagueSchedulerWorker', () => {
  it('closes due leagues and recomputes running ones in one round', async () => {
    const due = await createLeague(MIN);
    const running = await createLeague(60 * MIN);
    await join(due, 'Due');
    await join(running, 'Running');
    now += 2 * MIN;

    const env = parseEnv({ DATABASE_URL: 'postgres://x@localhost/x', REDIS_URL: 'redis://localhost' });
    const worker = new LeagueSchedulerWorker(ranking, closer, source, env, clock);
    await worker.runOnce();

    const [dueRow] = await ctx.db.select({ status: leagues.status }).from(leagues).where(eq(leagues.id, due));
    expect(dueRow?.status).toBe('finished');
    expect(await store.count(running)).toBe(1);
  });
});
