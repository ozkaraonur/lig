import { randomUUID } from 'node:crypto';
import { TIER_LEAGUE, type TierId } from '@lig/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type MsClock } from '../common/clock';
import { assets, leagues, memberships, players, quests, tierHistory, virtualOrders } from '../db/schema';
import { awardBadges } from '../gamification/badge-store';
import { DrizzleLeagueRepository } from '../leagues/drizzle-league.repository';
import { DrizzleOrderUnitOfWork } from '../orders/drizzle-orders';
import { OrdersService } from '../orders/orders.service';
import { PriceService } from '../prices/price.service';
import { RedisPriceStore } from '../prices/redis-price.store';
import { evaluatePlayerQuests } from '../quests/quest-evaluator';
import { DrizzleLeagueCloseUnitOfWork } from '../ranking/drizzle-ranking';
import { LeagueCloseService } from '../ranking/league-close.service';
import { RedisRankingStore } from '../ranking/redis-ranking.store';
import {
  connectIntegration,
  createTenant,
  deleteTenants,
  type IntegrationContext,
} from '../test/integration.test-utils';
import { joinTierLeague, tierView } from './tiers-store';

/** Kademe ligleri, gerçek PostgreSQL ve Redis ile (Faz 3, 5. adım, K-034). */
let ctx: IntegrationContext;
let tenantId: string;
let otherTenantId: string;
let symbol: string;
let assetId: string;
let now = Date.now();
const clock: MsClock = () => now;

/** 23 Eylül 2026 çarşamba: hafta pazartesi 21 Eylül 00:00 (Türkiye) = 20 Eylül 21:00 UTC. */
const WED = new Date('2026-09-23T09:00:00Z');
const WEEK_START = new Date('2026-09-20T21:00:00Z');
const WEEK_END = new Date('2026-09-27T21:00:00Z');

async function newPlayer(tier: TierId = 'bronze', forTenant = tenantId) {
  const [p] = await ctx.db
    .insert(players)
    .values({ tenantId: forTenant, externalId: `t-${randomUUID()}`, displayName: 'Kademeli', tier })
    .returning({ id: players.id });
  return p!.id;
}

const warmPool = () =>
  Promise.all(Array.from({ length: 16 }, () => ctx.db.execute(sql`select pg_sleep(0.05)`)));
const groupsOf = (forTenant: string, tier: TierId) =>
  ctx.db
    .select()
    .from(leagues)
    .where(and(eq(leagues.tenantId, forTenant), eq(leagues.type, 'tier'), eq(leagues.tier, tier)));
const membersOf = (leagueId: string) =>
  ctx.db.select().from(memberships).where(eq(memberships.leagueId, leagueId));
const tierOf = async (playerId: string) =>
  (await ctx.db.select({ t: players.tier }).from(players).where(eq(players.id, playerId)))[0]!.t;

beforeAll(async () => {
  ctx = connectIntegration();
  tenantId = await createTenant(ctx.db, 'tier');
  otherTenantId = await createTenant(ctx.db, 'tier-other');
  symbol = `K${Date.now()}`.slice(0, 16);
  const [a] = await ctx.db
    .insert(assets)
    .values({ tenantId, symbol, name: 'Kademe coin', assetClass: 'crypto' })
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

describe('katılım ve gruplar', () => {
  it('yeni oyuncu Bronz, grubu yok; katılınca haftalık grup açılır', async () => {
    const p = await newPlayer();
    const before = await tierView(ctx.db, tenantId, p, WED);
    expect(before).toMatchObject({ tier: 'bronze', tierName: 'Bronz', league: null, lastMovement: null });
    expect(before.weekEndsAt).toBe(WEEK_END.toISOString());

    const joined = await joinTierLeague(ctx.db, tenantId, p, WED);
    expect(joined.created).toBe(true);
    const [league] = await ctx.db.select().from(leagues).where(eq(leagues.id, joined.leagueId));
    expect(league).toMatchObject({
      type: 'tier',
      tier: 'bronze',
      status: 'active',
      maxMembers: 50,
      startingCash: '100000.00',
    });
    expect(league!.startsAt.toISOString()).toBe(WEEK_START.toISOString());
    expect(league!.endsAt.toISOString()).toBe(WEEK_END.toISOString());
    expect((await tierView(ctx.db, tenantId, p, WED)).league).toMatchObject({ id: joined.leagueId });
    expect(await membersOf(joined.leagueId)).toMatchObject([{ playerId: p, cash: '100000.00' }]);
  });

  it('aynı hafta ikinci katılım mevcut üyeliği döner, ikinci bakiye vermez', async () => {
    const p = await newPlayer('silver');
    const first = await joinTierLeague(ctx.db, tenantId, p, WED);
    const again = await joinTierLeague(ctx.db, tenantId, p, new Date(WED.getTime() + 3_600_000));
    expect(again).toEqual({ leagueId: first.leagueId, created: false });
    expect(await membersOf(first.leagueId)).toHaveLength(1);
  });

  it('gelecek hafta yeni grup açılır', async () => {
    const p = await newPlayer('platinum');
    const a = await joinTierLeague(ctx.db, tenantId, p, WED);
    const b = await joinTierLeague(ctx.db, tenantId, p, new Date(WED.getTime() + 7 * 86_400_000));
    expect(b.created).toBe(true);
    expect(b.leagueId).not.toBe(a.leagueId);
  });

  it('kademeler ve platformlar ayrı gruplarda toplanır (NFR-03)', async () => {
    const gold = await newPlayer('gold');
    const legend = await newPlayer('legend');
    const foreign = await newPlayer('gold', otherTenantId);
    const g = await joinTierLeague(ctx.db, tenantId, gold, WED);
    const l = await joinTierLeague(ctx.db, tenantId, legend, WED);
    const f = await joinTierLeague(ctx.db, otherTenantId, foreign, WED);
    expect(new Set([g.leagueId, l.leagueId, f.leagueId]).size).toBe(3);
    const [foreignLeague] = await ctx.db.select().from(leagues).where(eq(leagues.id, f.leagueId));
    expect(foreignLeague!.tenantId).toBe(otherTenantId);
  });

  it('başka platform üzerinden katılım 404', async () => {
    const p = await newPlayer();
    await expect(joinTierLeague(ctx.db, otherTenantId, p, WED)).rejects.toMatchObject({ status: 404 });
  });

  it('60 eşzamanlı katılımda gruplar 50 + 10 olur, grup numaraları tekil kalır', async () => {
    const tier: TierId = 'platinum';
    // Bu testte diğer platinum oyuncular farklı haftada; yeni bir hafta kullan.
    const week = new Date('2026-11-04T09:00:00Z');
    const crowd = await Promise.all(Array.from({ length: 60 }, () => newPlayer(tier)));
    await warmPool();

    const results = await Promise.allSettled(crowd.map((id) => joinTierLeague(ctx.db, tenantId, id, week)));
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);

    const groups = (await groupsOf(tenantId, tier)).filter(
      (g) => g.startsAt.toISOString() === '2026-11-01T21:00:00.000Z',
    );
    const sizes = await Promise.all(groups.map(async (g) => (await membersOf(g.id)).length));
    expect(sizes.sort((a, b) => b - a)).toEqual([TIER_LEAGUE.groupSize, 10]);
    expect(new Set(groups.map((g) => g.tierGroup)).size).toBe(groups.length);
  });
});

describe('görünürlük ve kısıtlar', () => {
  it('kademe grubu yalnızca üyesine görünür; kimlikle normal katılım kapalı', async () => {
    const repo = new DrizzleLeagueRepository(ctx.db);
    const member = await newPlayer();
    const stranger = await newPlayer();
    const { leagueId } = await joinTierLeague(ctx.db, tenantId, member, WED);
    expect(await repo.findVisible(tenantId, leagueId, member)).toMatchObject({ id: leagueId, joined: true });
    expect(await repo.findVisible(tenantId, leagueId, stranger)).toBeNull();
    expect((await repo.listVisible(tenantId, stranger, WED)).map((l) => l.id)).not.toContain(leagueId);
    expect(await repo.createMembership(tenantId, leagueId, stranger, WED)).toBeNull();
  });

  it('veritabanı: kademesiz tier ligi, tierli normal lig, 50 üstü kontenjan, çift grup ve bilinmeyen kademe reddedilir', async () => {
    const base = {
      tenantId,
      name: 'kısıt',
      status: 'active' as const,
      startsAt: new Date('2027-03-01T00:00:00Z'),
      endsAt: new Date('2027-03-08T00:00:00Z'),
      startingCash: '1000.00',
      assetIds: [assetId],
    };
    await expect(ctx.db.insert(leagues).values({ ...base, type: 'tier', maxMembers: 50 })).rejects.toThrow();
    await expect(
      ctx.db.insert(leagues).values({ ...base, type: 'weekly', tier: 'gold', tierGroup: 1 }),
    ).rejects.toThrow();
    await expect(
      ctx.db.insert(leagues).values({ ...base, type: 'tier', tier: 'gold', tierGroup: 1, maxMembers: 500 }),
    ).rejects.toThrow();
    await expect(
      ctx.db.insert(leagues).values({ ...base, type: 'tier', tier: 'elmas', tierGroup: 1, maxMembers: 50 }),
    ).rejects.toThrow();
    const ok = { ...base, type: 'tier' as const, tier: 'gold', tierGroup: 1, maxMembers: 50 };
    await ctx.db.insert(leagues).values(ok);
    await expect(ctx.db.insert(leagues).values(ok)).rejects.toThrow();
    const p = await newPlayer();
    await expect(ctx.db.update(players).set({ tier: 'elmas' }).where(eq(players.id, p))).rejects.toThrow();
  });

  it('"Bir lige katıl" görevi kademe grubu üyeliğini saymaz', async () => {
    const p = await newPlayer();
    await joinTierLeague(ctx.db, tenantId, p, new Date());
    const [q] = await ctx.db
      .insert(quests)
      .values({ tenantId, template: 'join_league', period: 'once', targetCount: 1, xpReward: 40 })
      .returning({ id: quests.id });
    await evaluatePlayerQuests(ctx.db, tenantId, p, new Date());
    expect((await ctx.db.select({ xp: players.xp }).from(players).where(eq(players.id, p)))[0]!.xp).toBe(0);
    await ctx.db.delete(quests).where(eq(quests.id, q!.id));
  });
});

describe('kapanışta yükselme ve düşme', () => {
  async function tierLeagueWith(count: number, tier: TierId = 'silver') {
    const [league] = await ctx.db
      .insert(leagues)
      .values({
        tenantId,
        name: 'kademe-kapanis',
        type: 'tier',
        status: 'active',
        startsAt: new Date(now - 7 * 86_400_000),
        endsAt: new Date(now - 1000),
        startingCash: '1000.00',
        assetIds: [assetId],
        maxMembers: 50,
        tier,
        tierGroup: Math.floor(Math.random() * 1_000_000),
      })
      .returning({ id: leagues.id });
    const members: Array<{ playerId: string; membershipId: string; rank: number }> = [];
    for (let i = 0; i < count; i += 1) {
      const playerId = await newPlayer(tier);
      const [m] = await ctx.db
        .insert(memberships)
        .values({ leagueId: league!.id, playerId, cash: '1000.00', finalRank: i + 1, finalValue: '1000.00' })
        .returning({ id: memberships.id });
      members.push({ playerId, membershipId: m!.id, rank: i + 1 });
    }
    return { leagueId: league!.id, members };
  }
  const trade = (membershipId: string) =>
    ctx.db.insert(virtualOrders).values({
      membershipId,
      assetId,
      side: 'buy',
      amount: '10.00',
      price: '10',
      quantity: '1',
      idempotencyKey: randomUUID(),
      requestHash: 'test',
    });
  const apply = (leagueId: string, tier: TierId) =>
    new DrizzleLeagueCloseUnitOfWork(ctx.db).run((tx) => tx.applyTierMovements(leagueId, tier));

  it('10 emir veren oyuncuda üst 2 yükselir, alt 2 düşer; tarih kaydı yazılır', async () => {
    const { leagueId, members } = await tierLeagueWith(10);
    for (const m of members) await trade(m.membershipId);
    expect(await apply(leagueId, 'silver')).toBe(4);

    const tiers = await Promise.all(members.map((m) => tierOf(m.playerId)));
    expect(tiers).toEqual([
      'gold',
      'gold',
      'silver',
      'silver',
      'silver',
      'silver',
      'silver',
      'silver',
      'bronze',
      'bronze',
    ]);
    const history = await ctx.db.select().from(tierHistory).where(eq(tierHistory.leagueId, leagueId));
    expect(history).toHaveLength(4);
  });

  it('aynı kapanışı ikinci kez uygulamak kimseyi ikinci kez oynatmaz', async () => {
    const { leagueId, members } = await tierLeagueWith(10);
    for (const m of members) await trade(m.membershipId);
    await apply(leagueId, 'silver');
    expect(await apply(leagueId, 'silver')).toBe(0);
    expect(await tierOf(members[0]!.playerId)).toBe('gold');
    expect(await tierOf(members[9]!.playerId)).toBe('bronze');
  });

  it('hiç emir vermeyenler sayılmaz ve yerinde kalır', async () => {
    const { leagueId, members } = await tierLeagueWith(10);
    // Yalnızca 6 kişi emir verdi (sıra 1-6); 4 kişi hiç oynamadı.
    for (const m of members.slice(0, 6)) await trade(m.membershipId);
    await apply(leagueId, 'silver');
    // 6 katılımcıda kota 1: sıra 1 yükselir, sıra 6 düşer.
    expect(await tierOf(members[0]!.playerId)).toBe('gold');
    expect(await tierOf(members[5]!.playerId)).toBe('bronze');
    for (const m of members.slice(6)) expect(await tierOf(m.playerId)).toBe('silver');
  });

  it('5 kişiden az katılımcıda hareket yok', async () => {
    const { leagueId, members } = await tierLeagueWith(10);
    for (const m of members.slice(0, 4)) await trade(m.membershipId);
    expect(await apply(leagueId, 'silver')).toBe(0);
    expect(await tierOf(members[0]!.playerId)).toBe('silver');
  });

  it('oyuncunun kademesi bu arada değiştiyse eski kapanış onu ezmez ve kayıt yazılmaz', async () => {
    const { leagueId, members } = await tierLeagueWith(5);
    for (const m of members) await trade(m.membershipId);
    await ctx.db.update(players).set({ tier: 'platinum' }).where(eq(players.id, members[0]!.playerId));
    await apply(leagueId, 'silver');
    expect(await tierOf(members[0]!.playerId)).toBe('platinum');
    const history = await ctx.db
      .select()
      .from(tierHistory)
      .where(and(eq(tierHistory.leagueId, leagueId), eq(tierHistory.playerId, members[0]!.playerId)));
    expect(history).toHaveLength(0);
  });

  it('başka ligdeki oyuncular etkilenmez', async () => {
    const { leagueId, members } = await tierLeagueWith(5);
    const bystander = await newPlayer('silver');
    for (const m of members) await trade(m.membershipId);
    await apply(leagueId, 'silver');
    expect(await tierOf(bystander)).toBe('silver');
  });

  it('gerçek kapanış: sıralama, XP ve kademe hareketi aynı transaction', async () => {
    now = Date.now();
    const store = new RedisPriceStore(ctx.redis);
    const prices = new PriceService(store, clock);
    await ctx.redis.del(`price:${tenantId}:${symbol}`);
    await store.saveIfNewer(tenantId, [{ symbol, price: '10', timestamp: now }]);
    const orders = new OrdersService(new DrizzleOrderUnitOfWork(ctx.db), prices, clock);

    const crowd = await Promise.all(Array.from({ length: 5 }, () => newPlayer('silver')));
    const joined = await Promise.all(crowd.map((id) => joinTierLeague(ctx.db, tenantId, id, new Date(now))));
    const leagueId = joined[0]!.leagueId;
    expect(new Set(joined.map((j) => j.leagueId)).size).toBe(1);

    // İlk oyuncu en çok, son oyuncu en az yatırım yapar; fiyat yükselince sıralama buna göre.
    const amounts = ['8000', '6000', '4000', '2000', '1000'];
    for (let i = 0; i < 5; i += 1) {
      await orders.place({ tenantId, playerId: crowd[i]!, createdAt: 0 }, leagueId, {
        assetId,
        side: 'buy',
        amount: amounts[i]!,
        idempotencyKey: randomUUID(),
      });
    }
    now += 1000;
    await ctx.redis.del(`price:${tenantId}:${symbol}`);
    await store.saveIfNewer(tenantId, [{ symbol, price: '12', timestamp: now }]);

    await ctx.db
      .update(leagues)
      .set({ endsAt: new Date(now - 1) })
      .where(eq(leagues.id, leagueId));
    const closer = new LeagueCloseService(
      new DrizzleLeagueCloseUnitOfWork(ctx.db),
      new RedisRankingStore(ctx.redis),
      prices,
      clock,
    );
    const closed = await closer.close(leagueId);
    expect(closed).toMatchObject({ closed: true, players: 5 });
    expect(await tierOf(crowd[0]!)).toBe('gold');
    expect(await tierOf(crowd[4]!)).toBe('bronze');
    for (const id of crowd.slice(1, 4)) expect(await tierOf(id)).toBe('silver');
    expect(await ctx.db.select().from(tierHistory).where(inArray(tierHistory.playerId, crowd))).toHaveLength(
      2,
    );
    await ctx.redis.del(`price:${tenantId}:${symbol}`);
  });
});

describe('Podyum rozeti kademe grubunda', () => {
  it('yeterli oyuncu emir vermediyse podyum verilmez, verdiyse verilir', async () => {
    const make = async (traders: number) => {
      const [league] = await ctx.db
        .insert(leagues)
        .values({
          tenantId,
          name: 'kademe-podyum',
          type: 'tier',
          status: 'finished',
          startsAt: new Date('2026-09-01T00:00:00Z'),
          endsAt: new Date('2026-09-08T00:00:00Z'),
          closedAt: new Date('2026-09-08T00:00:00Z'),
          startingCash: '1000.00',
          assetIds: [assetId],
          maxMembers: 50,
          tier: 'bronze',
          tierGroup: Math.floor(Math.random() * 1_000_000),
        })
        .returning({ id: leagues.id });
      const first = await newPlayer();
      const ids = [first];
      for (let i = 1; i < traders; i += 1) ids.push(await newPlayer());
      for (const [i, playerId] of ids.entries()) {
        const [m] = await ctx.db
          .insert(memberships)
          .values({ leagueId: league!.id, playerId, cash: '1000.00', finalRank: i + 1 })
          .returning({ id: memberships.id });
        await ctx.db.insert(virtualOrders).values({
          membershipId: m!.id,
          assetId,
          side: 'buy',
          amount: '10.00',
          price: '10',
          quantity: '1',
          idempotencyKey: randomUUID(),
          requestHash: 'test',
        });
      }
      return first;
    };
    const small = await make(3);
    expect(await awardBadges(ctx.db, tenantId, small, WED)).not.toContain('podium');
    const big = await make(TIER_LEAGUE.minParticipants);
    expect(await awardBadges(ctx.db, tenantId, big, WED)).toContain('podium');
  });
});
