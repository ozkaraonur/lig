import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env';
import { assets, leagues, outboxEvents, players, quests, xpLedger } from '../db/schema';
import { DrizzleLeagueRepository } from '../leagues/drizzle-league.repository';
import { DrizzleOrderUnitOfWork } from '../orders/drizzle-orders';
import { OrdersService } from '../orders/orders.service';
import { PriceService } from '../prices/price.service';
import { RedisPriceStore } from '../prices/redis-price.store';
import {
  connectIntegration,
  createTenant,
  deleteTenants,
  type IntegrationContext,
} from '../test/integration.test-utils';
import { DrizzlePlatformEventStore } from '../webhooks/drizzle-platform-events';
import { OutboxWorker } from './outbox.worker';
import { evaluatePlayerQuests, QuestsService } from './quest-evaluator';

let ctx: IntegrationContext;
let tenantId: string;
let leagueId: string;
let assetIds: string[];
let symbols: string[];
let orders: OrdersService;
let leagueRepo: DrizzleLeagueRepository;
let events: DrizzlePlatformEventStore;
let worker: OutboxWorker;
let questsService: QuestsService;
const questIds: Record<string, string> = {};

const env = parseEnv({ DATABASE_URL: 'postgres://x@localhost/x', REDIS_URL: 'redis://localhost' });

async function newPlayer(name = 'Görevci') {
  const externalId = `q-${randomUUID()}`;
  const [row] = await ctx.db
    .insert(players)
    .values({ tenantId, externalId, displayName: name })
    .returning({ id: players.id });
  return { session: { tenantId, playerId: row!.id, createdAt: 0 }, externalId };
}

async function freshPrices() {
  const store = new RedisPriceStore(ctx.redis);
  for (const symbol of symbols) {
    await ctx.redis.del(`price:${tenantId}:${symbol}`);
    await store.saveIfNewer(tenantId, [{ symbol, price: '10', timestamp: Date.now() }]);
  }
}

const xpOf = async (playerId: string) =>
  (await ctx.db.select({ xp: players.xp }).from(players).where(eq(players.id, playerId)))[0]!.xp;

const pendingFor = async (playerId: string) =>
  (
    await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(outboxEvents)
      .where(sql`${outboxEvents.playerId} = ${playerId} and ${outboxEvents.processedAt} is null`)
  )[0]!.n;

async function drain() {
  while ((await worker.runOnce()) > 0) {
    /* parti bitene kadar */
  }
}

beforeAll(async () => {
  ctx = connectIntegration();
  tenantId = await createTenant(ctx.db, 'quests-int');
  symbols = ['QA', 'QB', 'QC'].map((s) => `${s}${Date.now()}`.slice(0, 16));
  const inserted = await ctx.db
    .insert(assets)
    .values(symbols.map((symbol) => ({ tenantId, symbol, name: symbol, assetClass: 'crypto' as const })))
    .returning({ id: assets.id });
  assetIds = inserted.map((a) => a.id);
  const [league] = await ctx.db
    .insert(leagues)
    .values({
      tenantId,
      name: 'quest-int',
      type: 'weekly',
      status: 'active',
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 86_400_000),
      startingCash: '10000.00',
      assetIds,
    })
    .returning({ id: leagues.id });
  leagueId = league!.id;

  for (const [template, period, targetCount, xpReward] of [
    ['join_league', 'once', 1, 50],
    ['place_orders', 'weekly', 3, 100],
    ['trade_distinct_assets', 'weekly', 2, 150],
    ['real_trade', 'weekly', 1, 250],
  ] as const) {
    const [q] = await ctx.db
      .insert(quests)
      .values({ tenantId, template, period, targetCount, xpReward })
      .returning({ id: quests.id });
    questIds[template] = q!.id;
  }

  const prices = new PriceService(new RedisPriceStore(ctx.redis), () => Date.now());
  orders = new OrdersService(new DrizzleOrderUnitOfWork(ctx.db), prices, () => Date.now());
  leagueRepo = new DrizzleLeagueRepository(ctx.db);
  events = new DrizzlePlatformEventStore(ctx.db);
  worker = new OutboxWorker(ctx.db, env, () => Date.now());
  questsService = new QuestsService(ctx.db);
});

afterAll(async () => {
  for (const symbol of symbols) await ctx.redis.del(`price:${tenantId}:${symbol}`);
  await deleteTenants(ctx.db, [tenantId]);
  await ctx.close();
});

describe('quests via outbox (FR-07, K-013)', () => {
  it('completes quests from real actions and grants XP exactly once', async () => {
    const { session, externalId } = await newPlayer();
    await freshPrices();

    // Katılma ve emirler outbox olayını kendi transaction'larında yazar.
    expect(
      await leagueRepo.createMembership(tenantId, leagueId, session.playerId, new Date()),
    ).not.toBeNull();
    for (const assetId of [assetIds[0]!, assetIds[0]!, assetIds[1]!]) {
      await orders.place(session, leagueId, {
        assetId,
        side: 'buy',
        amount: '10',
        idempotencyKey: randomUUID(),
      });
    }
    expect(await pendingFor(session.playerId)).toBe(4);

    await drain();
    expect(await pendingFor(session.playerId)).toBe(0);
    expect(await xpOf(session.playerId)).toBe(50 + 100 + 150);

    // Gerçek işlem webhook'u → görev.
    const eventId = `evt_${randomUUID()}`;
    const occurredAt = new Date().toISOString();
    await events.record(tenantId, { eventId, type: 'real_trade', playerId: externalId, occurredAt });
    await events.record(tenantId, { eventId, type: 'real_trade', playerId: externalId, occurredAt });
    await drain();
    expect(await xpOf(session.playerId)).toBe(50 + 100 + 150 + 250);

    // Aynı oyuncuyu tekrar değerlendirmek XP'yi artırmaz.
    await evaluatePlayerQuests(ctx.db, tenantId, session.playerId, new Date());
    await evaluatePlayerQuests(ctx.db, tenantId, session.playerId, new Date());
    expect(await xpOf(session.playerId)).toBe(550);
    const ledger = await ctx.db.select().from(xpLedger).where(eq(xpLedger.playerId, session.playerId));
    expect(ledger).toHaveLength(4);
  });

  it('shows live progress and completion per quest', async () => {
    const { session } = await newPlayer();
    await freshPrices();
    await leagueRepo.createMembership(tenantId, leagueId, session.playerId, new Date());
    await orders.place(session, leagueId, {
      assetId: assetIds[2]!,
      side: 'buy',
      amount: '10',
      idempotencyKey: randomUUID(),
    });

    const beforeWorker = await questsService.listForPlayer(tenantId, session.playerId, new Date());
    const byTemplate = new Map(beforeWorker.map((q) => [q.template, q]));
    expect(byTemplate.get('place_orders')).toMatchObject({
      title: 'Bu hafta 3 emir ver',
      progress: 1,
      target: 3,
      completed: false,
    });
    expect(byTemplate.get('join_league')).toMatchObject({ progress: 1, completed: false, resetsAt: null });

    await drain();
    const after = await questsService.listForPlayer(tenantId, session.playerId, new Date());
    expect(after.find((q) => q.template === 'join_league')).toMatchObject({ completed: true });
    expect(after.find((q) => q.template === 'place_orders')?.resetsAt).not.toBeNull();
  });

  it('a platform event for someone who never opened the league is stored but triggers no quest', async () => {
    const result = await events.record(tenantId, {
      eventId: `evt_${randomUUID()}`,
      type: 'real_trade',
      playerId: 'never-played',
      occurredAt: new Date().toISOString(),
    });
    expect(result).toEqual({ duplicate: false, playerKnown: false });
  });

  it('two workers running at the same time never process the same event twice', async () => {
    const players = await Promise.all(Array.from({ length: 10 }, () => newPlayer()));
    for (const p of players)
      await leagueRepo.createMembership(tenantId, leagueId, p.session.playerId, new Date());

    const second = new OutboxWorker(ctx.db, env, () => Date.now());
    await Promise.all([
      drain(),
      (async () => {
        while ((await second.runOnce()) > 0) {
          /* parti bitene kadar */
        }
      })(),
    ]);

    for (const p of players) {
      expect(await pendingFor(p.session.playerId)).toBe(0);
      expect(await xpOf(p.session.playerId)).toBe(50);
    }
  });

  it("does not count another tenant's activity towards a player's quests (T4)", async () => {
    const { session } = await newPlayer();
    await leagueRepo.createMembership(tenantId, leagueId, session.playerId, new Date());
    const other = await createTenant(ctx.db, 'quests-int-other');
    try {
      await ctx.db
        .insert(quests)
        .values({ tenantId: other, template: 'join_league', period: 'once', targetCount: 1, xpReward: 999 });
      // Oyuncunun A platformundaki katılımı, B platformunun "bir lige katıl" görevini tamamlamamalı.
      const result = await evaluatePlayerQuests(ctx.db, other, session.playerId, new Date());
      expect(result).toEqual({ completed: [], xpGranted: 0 });
    } finally {
      await deleteTenants(ctx.db, [other]);
    }
  });
});
