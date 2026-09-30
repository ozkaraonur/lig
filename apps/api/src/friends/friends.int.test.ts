import { randomUUID } from 'node:crypto';
import { createFriendsLeagueRequest, FRIENDS_LEAGUE, joinByCodeRequest } from '@lig/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type MsClock } from '../common/clock';
import { assets, leagues, memberships, players, quests, xpLedger } from '../db/schema';
import { DrizzleAppearanceReader } from '../gamification/drizzle-profile';
import { DrizzleLeagueRepository } from '../leagues/drizzle-league.repository';
import { DrizzleOrderUnitOfWork } from '../orders/drizzle-orders';
import { OrdersService } from '../orders/orders.service';
import { PriceService } from '../prices/price.service';
import { RedisPriceStore } from '../prices/redis-price.store';
import { evaluatePlayerQuests } from '../quests/quest-evaluator';
import {
  DrizzleFinalStandingsReader,
  DrizzleLeagueCloseUnitOfWork,
  DrizzleRankingSource,
} from '../ranking/drizzle-ranking';
import { LeagueCloseService } from '../ranking/league-close.service';
import { RankingService } from '../ranking/ranking.service';
import { RedisRankingStore } from '../ranking/redis-ranking.store';
import {
  connectIntegration,
  createTenant,
  deleteTenants,
  type IntegrationContext,
} from '../test/integration.test-utils';
import { createFriendsLeague, generateInviteCode, joinByCode } from './friends-store';

/** Arkadaş ligi ve davet kodu, gerçek PostgreSQL ve Redis ile (Faz 3, 4. adım, K-033). */
let ctx: IntegrationContext;
let tenantId: string;
let otherTenantId: string;
let symbol: string;
let assetId: string;
let now = Date.now();
const clock: MsClock = () => now;

const request = (name = 'Kuzenler', durationDays: 7 | 14 | 30 = 7) =>
  createFriendsLeagueRequest.parse({ name, durationDays });

async function newPlayer(forTenant = tenantId) {
  const [p] = await ctx.db
    .insert(players)
    .values({ tenantId: forTenant, externalId: `f-${randomUUID()}`, displayName: 'Arkadaş' })
    .returning({ id: players.id });
  return p!.id;
}

const createFor = (playerId: string, at = new Date(now)) =>
  createFriendsLeague(ctx.db, tenantId, playerId, request(), at);
const codeOf = async (leagueId: string) =>
  (await ctx.db.select({ c: leagues.inviteCode }).from(leagues).where(eq(leagues.id, leagueId)))[0]!.c!;
const membersOf = (leagueId: string) =>
  ctx.db.select().from(memberships).where(eq(memberships.leagueId, leagueId));
const warmPool = () =>
  Promise.all(Array.from({ length: 12 }, () => ctx.db.execute(sql`select pg_sleep(0.05)`)));

beforeAll(async () => {
  ctx = connectIntegration();
  tenantId = await createTenant(ctx.db, 'friends');
  otherTenantId = await createTenant(ctx.db, 'friends-other');
  symbol = `F${Date.now()}`.slice(0, 16);
  const [a] = await ctx.db
    .insert(assets)
    .values({ tenantId, symbol, name: 'Arkadaş coin', assetClass: 'crypto' })
    .returning({ id: assets.id });
  assetId = a!.id;
  await ctx.db
    .insert(assets)
    .values({ tenantId: otherTenantId, symbol: 'YBN', name: 'Yabancı', assetClass: 'crypto' });
});

afterAll(async () => {
  await ctx.redis.del(`price:${tenantId}:${symbol}`);
  await deleteTenants(ctx.db, [tenantId, otherTenantId]);
  await ctx.close();
});

describe('lig kurma', () => {
  it('kuralları sabit bir lig açar ve kurucuyu üye yapar', async () => {
    const owner = await newPlayer();
    const res = await createFor(owner);
    const [league] = await ctx.db.select().from(leagues).where(eq(leagues.id, res.leagueId));
    expect(league).toMatchObject({
      type: 'friends',
      status: 'active',
      maxMembers: FRIENDS_LEAGUE.maxMembers,
      startingCash: '100000.00',
      ownerPlayerId: owner,
      tenantId,
    });
    expect(league!.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    // Varlıklar yalnızca oyuncunun platformundan.
    expect(league!.assetIds).toEqual([assetId]);
    expect(league!.endsAt.getTime() - league!.startsAt.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    const members = await membersOf(res.leagueId);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ playerId: owner, cash: '100000.00' });
  });

  it('bakiye, kontenjan ve varlık istemciden alınmaz (katı şema)', () => {
    for (const extra of [
      { startingCash: '999999' },
      { maxMembers: 500 },
      { assetIds: [] },
      { type: 'weekly' },
    ]) {
      expect(
        createFriendsLeagueRequest.safeParse({ name: 'Kuzenler', durationDays: 7, ...extra }).success,
      ).toBe(false);
    }
    expect(createFriendsLeagueRequest.safeParse({ name: 'Kuzenler', durationDays: 365 }).success).toBe(false);
  });

  it('oyuncu başına en fazla 3 etkin arkadaş ligi; süresi dolan sayılmaz', async () => {
    const owner = await newPlayer();
    await createFor(owner);
    await createFor(owner);
    await createFor(owner);
    await expect(createFor(owner)).rejects.toMatchObject({ status: 409 });
    // 8 gün sonra ilk üç lig (7 günlük) bitmiş sayılır.
    const later = new Date(now + 8 * 24 * 60 * 60 * 1000);
    await expect(createFor(owner, later)).resolves.toMatchObject({ created: true });
  });

  it('eşzamanlı 8 kurma isteğinde yalnızca 3 lig açılır', async () => {
    const owner = await newPlayer();
    await warmPool();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => createFor(owner)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const owned = await ctx.db.select().from(leagues).where(eq(leagues.ownerPlayerId, owner));
    expect(owned).toHaveLength(3);
  });

  it('başka platformun oyuncusu için lig kurulamaz (NFR-03)', async () => {
    const foreigner = await newPlayer(otherTenantId);
    await expect(createFor(foreigner)).rejects.toMatchObject({ status: 404 });
  });

  it('kod çakışırsa yeni kod denenir', async () => {
    const owner = await newPlayer();
    const first = await createFriendsLeague(
      ctx.db,
      tenantId,
      owner,
      request(),
      new Date(now),
      () => 'AAAAAAAAAA',
    );
    const codes = ['AAAAAAAAAA', 'BBBBBBBBBB'];
    const second = await createFriendsLeague(ctx.db, tenantId, owner, request(), new Date(now), () =>
      codes.shift()!,
    );
    expect(await codeOf(first.leagueId)).toBe('AAAAAAAAAA');
    expect(await codeOf(second.leagueId)).toBe('BBBBBBBBBB');
  });

  it('üretilen kodlar alfabeye uyar', () => {
    for (let i = 0; i < 50; i += 1) expect(generateInviteCode()).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
  });
});

describe('veritabanı kısıtları', () => {
  const base = () => ({
    tenantId,
    name: 'kısıt',
    status: 'active' as const,
    startsAt: new Date(now),
    endsAt: new Date(now + 86_400_000),
    startingCash: '1000.00',
    assetIds: [assetId],
  });

  it('kodsuz arkadaş ligi, kontenjansız arkadaş ligi ve kodlu normal lig reddedilir', async () => {
    await expect(
      ctx.db.insert(leagues).values({ ...base(), type: 'friends', maxMembers: 10 }),
    ).rejects.toThrow();
    await expect(
      ctx.db.insert(leagues).values({ ...base(), type: 'friends', inviteCode: 'CCCCCCCCCC' }),
    ).rejects.toThrow();
    await expect(
      ctx.db
        .insert(leagues)
        .values({ ...base(), type: 'friends', inviteCode: 'CCCCCCCCCC', maxMembers: 500 }),
    ).rejects.toThrow();
    await expect(
      ctx.db.insert(leagues).values({ ...base(), type: 'weekly', inviteCode: 'CCCCCCCCCC' }),
    ).rejects.toThrow();
  });

  it('aynı kod iki lige verilemez', async () => {
    const row = { ...base(), type: 'friends' as const, maxMembers: 10, inviteCode: 'DDDDDDDDDD' };
    await ctx.db.insert(leagues).values(row);
    await expect(ctx.db.insert(leagues).values(row)).rejects.toThrow();
  });
});

describe('koda katılma', () => {
  it('katılır, tekrar çağrı ikinci üyelik açmaz', async () => {
    const owner = await newPlayer();
    const friend = await newPlayer();
    const { leagueId } = await createFor(owner);
    const code = await codeOf(leagueId);

    const first = await joinByCode(ctx.db, tenantId, friend, code, new Date(now));
    const again = await joinByCode(ctx.db, tenantId, friend, code, new Date(now));
    expect(first).toEqual({ leagueId, created: true });
    expect(again).toEqual({ leagueId, created: false });
    expect(await membersOf(leagueId)).toHaveLength(2);
  });

  it('küçük harf, boşluk ve tire kabul edilir', async () => {
    const parsed = joinByCodeRequest.parse({ code: ' abcde-fghjk ' });
    expect(parsed.code).toBe('ABCDEFGHJK');
    expect(joinByCodeRequest.safeParse({ code: 'KISA' }).success).toBe(false);
    expect(joinByCodeRequest.safeParse({ code: 'ABCDEFGHI0' }).success).toBe(false);
  });

  it('yanlış kod, başka platformun kodu ve normal lig aynı 404 yanıtını alır (T4)', async () => {
    const owner = await newPlayer();
    const foreigner = await newPlayer(otherTenantId);
    const { leagueId } = await createFor(owner);
    const code = await codeOf(leagueId);
    const [regular] = await ctx.db
      .insert(leagues)
      .values({
        tenantId,
        name: 'normal',
        type: 'weekly',
        status: 'active',
        startsAt: new Date(now),
        endsAt: new Date(now + 86_400_000),
        startingCash: '1000.00',
        assetIds: [assetId],
      })
      .returning({ id: leagues.id });

    const messages = new Set<string>();
    for (const attempt of [
      () => joinByCode(ctx.db, tenantId, owner, 'ZZZZZZZZZZ', new Date(now)),
      () => joinByCode(ctx.db, otherTenantId, foreigner, code, new Date(now)),
      () => joinByCode(ctx.db, tenantId, owner, regular!.id.slice(0, 10).toUpperCase(), new Date(now)),
    ]) {
      const err = await attempt().catch((e: unknown) => e as { status: number; message: string });
      expect(err).toMatchObject({ status: 404 });
      messages.add((err as { message: string }).message);
    }
    expect(messages.size).toBe(1);
    expect(await membersOf(leagueId)).toHaveLength(1);
  });

  it('süresi dolmuş lige katılım reddedilir', async () => {
    const owner = await newPlayer();
    const friend = await newPlayer();
    const { leagueId } = await createFor(owner);
    const code = await codeOf(leagueId);
    const after = new Date(now + 8 * 24 * 60 * 60 * 1000);
    await expect(joinByCode(ctx.db, tenantId, friend, code, after)).rejects.toMatchObject({ status: 409 });
    expect(await membersOf(leagueId)).toHaveLength(1);
  });

  it('kontenjan dolunca 409; 25 eşzamanlı katılımda üye sayısı 10u aşmaz', async () => {
    const owner = await newPlayer();
    const { leagueId } = await createFor(owner);
    const code = await codeOf(leagueId);
    const friends = await Promise.all(Array.from({ length: 25 }, () => newPlayer()));
    await warmPool();

    const results = await Promise.allSettled(
      friends.map((f) => joinByCode(ctx.db, tenantId, f, code, new Date(now))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(FRIENDS_LEAGUE.maxMembers - 1);
    expect(await membersOf(leagueId)).toHaveLength(FRIENDS_LEAGUE.maxMembers);
    const late = await newPlayer();
    await expect(joinByCode(ctx.db, tenantId, late, code, new Date(now))).rejects.toMatchObject({
      status: 409,
      code: 'LEAGUE_FULL',
    });
  });

  it('aynı oyuncunun 12 eşzamanlı katılımı tek üyelik açar', async () => {
    const owner = await newPlayer();
    const friend = await newPlayer();
    const { leagueId } = await createFor(owner);
    const code = await codeOf(leagueId);
    await warmPool();
    await Promise.all(
      Array.from({ length: 12 }, () => joinByCode(ctx.db, tenantId, friend, code, new Date(now))),
    );
    expect((await membersOf(leagueId)).filter((m) => m.playerId === friend)).toHaveLength(1);
  });
});

describe('görünürlük (T4)', () => {
  it('arkadaş ligini yalnızca üyeleri görür; kod yalnızca üyeye döner', async () => {
    const repo = new DrizzleLeagueRepository(ctx.db);
    const owner = await newPlayer();
    const friend = await newPlayer();
    const stranger = await newPlayer();
    const foreigner = await newPlayer(otherTenantId);
    const { leagueId } = await createFor(owner);
    const code = await codeOf(leagueId);
    await joinByCode(ctx.db, tenantId, friend, code, new Date(now));

    for (const member of [owner, friend]) {
      const found = await repo.findVisible(tenantId, leagueId, member);
      expect(found).toMatchObject({ id: leagueId, joined: true, inviteCode: code, memberCount: 2 });
      expect((await repo.listVisible(tenantId, member, new Date(now))).map((l) => l.id)).toContain(leagueId);
    }
    expect(await repo.findVisible(tenantId, leagueId, stranger)).toBeNull();
    expect((await repo.listVisible(tenantId, stranger, new Date(now))).map((l) => l.id)).not.toContain(
      leagueId,
    );
    expect(await repo.findVisible(otherTenantId, leagueId, foreigner)).toBeNull();
    // Normal katılım ucu arkadaş ligine kapalı: yalnızca kodla girilir.
    expect(await repo.createMembership(tenantId, leagueId, stranger, new Date(now))).toBeNull();
  });
});

describe('oynanış ve ödül', () => {
  it('üyeler emir verir, sıralama görünür; kapanışta XP verilmez; katılım görevi saymaz', async () => {
    now = Date.now();
    const priceStore = new RedisPriceStore(ctx.redis);
    const priceService = new PriceService(priceStore, clock);
    await ctx.redis.del(`price:${tenantId}:${symbol}`);
    await priceStore.saveIfNewer(tenantId, [{ symbol, price: '10', timestamp: now }]);
    const orders = new OrdersService(new DrizzleOrderUnitOfWork(ctx.db), priceService, clock);

    const owner = await newPlayer();
    const friend = await newPlayer();
    const { leagueId } = await createFor(owner, new Date(now));
    await joinByCode(ctx.db, tenantId, friend, await codeOf(leagueId), new Date(now));

    await orders.place({ tenantId, playerId: owner, createdAt: 0 }, leagueId, {
      assetId,
      side: 'buy',
      amount: '1000',
      idempotencyKey: randomUUID(),
    });

    const store = new RedisRankingStore(ctx.redis);
    const ranking = new RankingService(
      new DrizzleRankingSource(ctx.db),
      store,
      new DrizzleFinalStandingsReader(ctx.db),
      new DrizzleAppearanceReader(ctx.db),
      new DrizzleLeagueRepository(ctx.db),
      priceService,
      clock,
    );
    await ranking.recompute({ id: leagueId, tenantId });
    const board = await ranking.leaderboard({ tenantId, playerId: friend, createdAt: 0 }, leagueId, 5);
    expect(board.playerCount).toBe(2);

    // Lig süresi dolunca kapanır, ama XP vermez.
    await ctx.db
      .update(leagues)
      .set({ startsAt: new Date(now - 60_000), endsAt: new Date(now - 1000) })
      .where(eq(leagues.id, leagueId));
    const closer = new LeagueCloseService(
      new DrizzleLeagueCloseUnitOfWork(ctx.db),
      store,
      priceService,
      clock,
    );
    const closed = await closer.close(leagueId);
    expect(closed).toMatchObject({ closed: true, players: 2, xpGranted: 0 });
    const ledger = await ctx.db.select().from(xpLedger).where(eq(xpLedger.sourceId, leagueId));
    expect(ledger).toHaveLength(0);

    // "Bir lige katıl" görevi arkadaş ligine katılmayı saymaz.
    const [quest] = await ctx.db
      .insert(quests)
      .values({ tenantId, template: 'join_league', period: 'once', targetCount: 1, xpReward: 40 })
      .returning({ id: quests.id });
    await evaluatePlayerQuests(ctx.db, tenantId, friend, new Date(now));
    const xp = (await ctx.db.select({ xp: players.xp }).from(players).where(eq(players.id, friend)))[0]!.xp;
    expect(xp).toBe(0);
    await ctx.db.delete(quests).where(and(eq(quests.id, quest!.id)));
    await ctx.redis.del(`price:${tenantId}:${symbol}`);
  });
});
