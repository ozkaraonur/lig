import { randomUUID } from 'node:crypto';
import { type PlaceOrderRequest } from '@lig/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { systemClockMs } from '../common/clock';
import { AppError } from '../common/app-error';
import { assets, leagues, memberships, players, positions, virtualOrders } from '../db/schema';
import { PriceService } from '../prices/price.service';
import { RedisPriceStore } from '../prices/redis-price.store';
import {
  connectIntegration,
  createTenant,
  deleteTenants,
  type IntegrationContext,
} from '../test/integration.test-utils';
import { DrizzleOrderUnitOfWork, DrizzlePortfolioReader } from './drizzle-orders';
import { OrdersService } from './orders.service';

let ctx: IntegrationContext;
let service: OrdersService;
let reader: DrizzlePortfolioReader;
let priceStore: RedisPriceStore;
let tenantId: string;
let assetId: string;
let symbol: string;

const DAY = 24 * 60 * 60 * 1000;

async function newMember(startingCash = '100000.00') {
  const [league] = await ctx.db
    .insert(leagues)
    .values({
      tenantId,
      name: 'int',
      type: 'weekly',
      status: 'active',
      startsAt: new Date(Date.now() - DAY),
      endsAt: new Date(Date.now() + DAY),
      startingCash,
      assetIds: [assetId],
    })
    .returning({ id: leagues.id });
  const [player] = await ctx.db
    .insert(players)
    .values({ tenantId, externalId: randomUUID(), displayName: 'int' })
    .returning({ id: players.id });
  const [membership] = await ctx.db
    .insert(memberships)
    .values({ leagueId: league!.id, playerId: player!.id, cash: startingCash })
    .returning({ id: memberships.id });
  return {
    leagueId: league!.id,
    membershipId: membership!.id,
    session: { tenantId, playerId: player!.id, createdAt: 0 },
  };
}

const buy = (amount: string, idempotencyKey = randomUUID()): PlaceOrderRequest => ({
  assetId,
  side: 'buy',
  amount,
  idempotencyKey,
});

async function cashOf(membershipId: string) {
  const [row] = await ctx.db
    .select({ cash: memberships.cash })
    .from(memberships)
    .where(eq(memberships.id, membershipId));
  return row!.cash;
}

beforeAll(async () => {
  ctx = connectIntegration();
  priceStore = new RedisPriceStore(ctx.redis);
  service = new OrdersService(
    new DrizzleOrderUnitOfWork(ctx.db),
    new PriceService(priceStore, systemClockMs),
    systemClockMs,
  );
  reader = new DrizzlePortfolioReader(ctx.db);
  tenantId = await createTenant(ctx.db, 'orders-int');
  symbol = `T${Date.now()}`.slice(0, 16);
  const [asset] = await ctx.db
    .insert(assets)
    .values({ tenantId, symbol, name: 'Test coin', assetClass: 'crypto' })
    .returning({ id: assets.id });
  assetId = asset!.id;
});

beforeEach(async () => {
  // Fiyatın her testte taze olması için zaman damgası şimdi.
  await ctx.redis.del(`price:${tenantId}:${symbol}`);
  await priceStore.saveIfNewer(tenantId, [{ symbol, price: '1000', timestamp: Date.now() }]);
});

afterAll(async () => {
  await ctx.redis.del(`price:${tenantId}:${symbol}`);
  await deleteTenants(ctx.db, [tenantId]);
  await ctx.close();
});

describe('Orders against PostgreSQL (integration)', () => {
  it('writes cash, position and order with exact numeric values', async () => {
    const m = await newMember();
    const res = await service.place(m.session, m.leagueId, buy('2500.50'));

    expect(res).toMatchObject({
      replayed: false,
      cash: '97499.50',
      order: { amount: '2500.50', price: '1000.0000000000', quantity: '2.5005000000' },
      position: { quantity: '2.5005000000', avgCost: '1000.0000000000' },
    });
    expect(await cashOf(m.membershipId)).toBe('97499.50');
    expect(await reader.listPositions(m.membershipId)).toEqual([
      { assetId, quantity: '2.5005000000', avgCost: '1000.0000000000', symbol, name: 'Test coin' },
    ]);
    const history = await reader.listOrders(m.membershipId, 10);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      side: 'buy',
      symbol,
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('20 parallel buys can never overdraw the balance (T3)', async () => {
    const m = await newMember();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => service.place(m.session, m.leagueId, buy('10000'))),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(ok).toHaveLength(10);
    expect(failed.map((f) => (f.reason as AppError).code)).toEqual(Array(10).fill('INSUFFICIENT_CASH'));
    expect(await cashOf(m.membershipId)).toBe('0.00');

    const [pos] = await reader.listPositions(m.membershipId);
    expect(pos?.quantity).toBe('100.0000000000');
    const [count] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(virtualOrders)
      .where(eq(virtualOrders.membershipId, m.membershipId));
    expect(count?.n).toBe(10);
  });

  it('the same idempotency key sent 10 times in parallel creates one order (FR-33)', async () => {
    const m = await newMember();
    const body = buy('1000');
    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.place(m.session, m.leagueId, body)),
    );
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
    expect(await cashOf(m.membershipId)).toBe('99000.00');
  });

  it('parallel "sell all" requests sell the position only once', async () => {
    const m = await newMember();
    await service.place(m.session, m.leagueId, buy('5000'));
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service.place(m.session, m.leagueId, {
          assetId,
          side: 'sell',
          all: true,
          idempotencyKey: randomUUID(),
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await cashOf(m.membershipId)).toBe('100000.00');
    expect(await reader.listPositions(m.membershipId)).toEqual([]);
  });

  it('orders of different players do not block each other', async () => {
    const members = await Promise.all(Array.from({ length: 5 }, () => newMember()));
    const results = await Promise.all(members.map((m) => service.place(m.session, m.leagueId, buy('100'))));
    expect(results.every((r) => r.cash === '99900.00')).toBe(true);
  });

  it('database constraints reject a negative balance or an empty position even if code had a bug', async () => {
    const m = await newMember();
    await expect(
      ctx.db.update(memberships).set({ cash: '-0.01' }).where(eq(memberships.id, m.membershipId)),
    ).rejects.toThrow();
    await expect(
      ctx.db.insert(positions).values({ membershipId: m.membershipId, assetId, quantity: '0', avgCost: '1' }),
    ).rejects.toThrow();
  });

  it('refuses to trade once the price in Redis is older than the limit', async () => {
    const m = await newMember();
    await ctx.redis.del(`price:${tenantId}:${symbol}`);
    await priceStore.saveIfNewer(tenantId, [{ symbol, price: '1000', timestamp: Date.now() - 10_000 }]);
    await expect(service.place(m.session, m.leagueId, buy('100'))).rejects.toMatchObject({
      code: 'PRICE_STALE',
    });
    expect(await cashOf(m.membershipId)).toBe('100000.00');
  });

  it('an asset with open positions cannot be deleted on its own', async () => {
    const m = await newMember();
    await service.place(m.session, m.leagueId, buy('100'));
    await expect(ctx.db.delete(assets).where(eq(assets.id, assetId))).rejects.toThrow();
  });

  it('deleting a tenant in the documented order removes its positions and orders (offboarding)', async () => {
    const otherTenant = await createTenant(ctx.db, 'orders-int-delete');
    const [asset] = await ctx.db
      .insert(assets)
      .values({ tenantId: otherTenant, symbol: 'DEL', name: 'Del', assetClass: 'crypto' })
      .returning({ id: assets.id });
    const [league] = await ctx.db
      .insert(leagues)
      .values({
        tenantId: otherTenant,
        name: 'del',
        type: 'weekly',
        status: 'active',
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
        startingCash: '1000.00',
        assetIds: [asset!.id],
      })
      .returning({ id: leagues.id });
    const [player] = await ctx.db
      .insert(players)
      .values({ tenantId: otherTenant, externalId: 'del', displayName: 'del' })
      .returning({ id: players.id });
    const [membership] = await ctx.db
      .insert(memberships)
      .values({ leagueId: league!.id, playerId: player!.id, cash: '1000.00' })
      .returning({ id: memberships.id });
    await ctx.db
      .insert(positions)
      .values({ membershipId: membership!.id, assetId: asset!.id, quantity: '1', avgCost: '1' });

    await deleteTenants(ctx.db, [otherTenant]);
    expect(await ctx.db.select().from(positions).where(eq(positions.membershipId, membership!.id))).toEqual(
      [],
    );
  });
});
