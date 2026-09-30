import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assets,
  leagues,
  memberships,
  playerActivityDays,
  players,
  quests,
  virtualOrders,
  xpJokers,
  xpLedger,
} from '../db/schema';
import { evaluatePlayerQuests } from '../quests/quest-evaluator';
import {
  connectIntegration,
  createTenant,
  deleteTenants,
  type IntegrationContext,
} from '../test/integration.test-utils';
import { activateJoker, awardStreak, jokerActiveAt, recordVisit, streakView } from './streak-store';

/** Günlük seri ve XP jokeri, gerçek PostgreSQL ile (Faz 3, 3. adım, K-032). */
let ctx: IntegrationContext;
let tenantId: string;
let otherTenantId: string;
let leagueId: string;
let assetId: string;

/** 23 Eylül 2026 çarşamba 12:00, Türkiye saatiyle de aynı gün. */
const NOW = new Date('2026-09-23T09:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const dayOffset = (offset: number) => new Date(NOW.getTime() - offset * DAY_MS).toISOString().slice(0, 10);

async function newPlayer(forTenant = tenantId) {
  const [player] = await ctx.db
    .insert(players)
    .values({ tenantId: forTenant, externalId: `s-${randomUUID()}`, displayName: 'Seri' })
    .returning({ id: players.id });
  return player!.id;
}

async function addDays(playerId: string, offsets: number[], forTenant = tenantId) {
  await ctx.db
    .insert(playerActivityDays)
    .values(offsets.map((o) => ({ playerId, tenantId: forTenant, day: dayOffset(o) })));
}

const xpOf = async (playerId: string) =>
  (await ctx.db.select({ xp: players.xp }).from(players).where(eq(players.id, playerId)))[0]!.xp;
const jokersOf = (playerId: string) => ctx.db.select().from(xpJokers).where(eq(xpJokers.playerId, playerId));

beforeAll(async () => {
  ctx = connectIntegration();
  tenantId = await createTenant(ctx.db, 'streak');
  otherTenantId = await createTenant(ctx.db, 'streak-other');
  const [asset] = await ctx.db
    .insert(assets)
    .values({ tenantId, symbol: 'SRI', name: 'Seri', assetClass: 'equity', sector: 'Bankacılık' })
    .returning({ id: assets.id });
  assetId = asset!.id;
  const [league] = await ctx.db
    .insert(leagues)
    .values({
      tenantId,
      name: 'streak-league',
      type: 'weekly',
      status: 'active',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2026-10-30T00:00:00Z'),
      startingCash: '1000.00',
      assetIds: [assetId],
    })
    .returning({ id: leagues.id });
  leagueId = league!.id;
});

afterAll(async () => {
  await deleteTenants(ctx.db, [tenantId, otherTenantId]);
  await ctx.close();
});

describe('ziyaret günü', () => {
  it('aynı gün art arda ziyaret tek satır yazar', async () => {
    const p = await newPlayer();
    await Promise.all([1, 2, 3, 4].map(() => recordVisit(ctx.db, tenantId, p, NOW)));
    const rows = await ctx.db.select().from(playerActivityDays).where(eq(playerActivityDays.playerId, p));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.day).toBe('2026-09-23');
  });

  it('gün Türkiye takvimiyle yazılır: 21:30 UTC ertesi güne sayılır', async () => {
    const p = await newPlayer();
    await recordVisit(ctx.db, tenantId, p, new Date('2026-09-23T21:30:00Z'));
    const [row] = await ctx.db.select().from(playerActivityDays).where(eq(playerActivityDays.playerId, p));
    expect(row?.day).toBe('2026-09-24');
  });

  it('başka tenant üzerinden yazılamaz (NFR-03)', async () => {
    const p = await newPlayer();
    await recordVisit(ctx.db, otherTenantId, p, NOW);
    const rows = await ctx.db.select().from(playerActivityDays).where(eq(playerActivityDays.playerId, p));
    expect(rows).toHaveLength(0);
  });
});

describe('seri hesabı', () => {
  it('emir günleri de seriye sayılır (Türkiye günü)', async () => {
    const p = await newPlayer();
    const [m] = await ctx.db
      .insert(memberships)
      .values({ leagueId, playerId: p, cash: '1000.00' })
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
      // 22 Eylül 21:30 UTC, Türkiye'de 23 Eylül 00:30.
      createdAt: new Date('2026-09-22T21:30:00Z'),
    });
    await addDays(p, [1]);
    const view = await streakView(ctx.db, tenantId, p, NOW);
    expect(view.days).toBe(2);
    // 00:30 Türkiye saati bugündür: UTC'de dün görünen emir bugünün etkin günü sayılır.
    expect(view.activeToday).toBe(true);
  });

  it('bir gün kaçırmak seriyi sürdürür, iki gün kaçırmak koparır', async () => {
    const keeps = await newPlayer();
    await addDays(keeps, [0, 2, 4]);
    expect((await streakView(ctx.db, tenantId, keeps, NOW)).days).toBe(3);

    const breaks = await newPlayer();
    await addDays(breaks, [0, 3, 4]);
    expect((await streakView(ctx.db, tenantId, breaks, NOW)).days).toBe(1);
  });

  it('başka oyuncunun ve başka tenant oyuncusunun günleri sayılmaz', async () => {
    const mine = await newPlayer();
    const theirs = await newPlayer();
    const foreign = await newPlayer(otherTenantId);
    await addDays(theirs, [0, 1, 2]);
    await addDays(foreign, [0, 1, 2], otherTenantId);
    expect((await streakView(ctx.db, tenantId, mine, NOW)).days).toBe(0);
    // Yanlış tenant ile sorulan oyuncunun serisi görünmez.
    expect((await streakView(ctx.db, otherTenantId, theirs, NOW)).days).toBe(0);
  });
});

describe('seri ödülü (yarış koşulu)', () => {
  it('7. günde 25 XP ve bir joker verilir; 12 eşzamanlı çağrıda da bir kez', async () => {
    const p = await newPlayer();
    await addDays(p, [0, 1, 2, 3, 4, 5, 6]);

    await Promise.all(Array.from({ length: 12 }, () => awardStreak(ctx.db, tenantId, p, NOW)));

    expect(await xpOf(p)).toBe(25);
    expect(await jokersOf(p)).toHaveLength(1);
    const ledger = await ctx.db
      .select()
      .from(xpLedger)
      .where(and(eq(xpLedger.playerId, p), eq(xpLedger.reason, 'streak')));
    expect(ledger).toHaveLength(1);
  });

  it('6 günde ödül yok, 14. günde ikinci ödül gelir', async () => {
    const p = await newPlayer();
    await addDays(p, [0, 1, 2, 3, 4, 5]);
    await awardStreak(ctx.db, tenantId, p, NOW);
    expect(await xpOf(p)).toBe(0);

    await addDays(p, [6, 7, 8, 9, 10, 11, 12, 13]);
    await awardStreak(ctx.db, tenantId, p, NOW);
    expect(await xpOf(p)).toBe(50);
    expect(await jokersOf(p)).toHaveLength(2);
  });

  it('seri kopup yeniden başlarsa yeni seri yeni ödül kazanır', async () => {
    const p = await newPlayer();
    // Eski seri: 20-14 gün önce (7 gün). Sonra 3 günlük boşluk, yeni seri 0-6 gün önce.
    await addDays(p, [20, 19, 18, 17, 16, 15, 14]);
    await awardStreak(ctx.db, tenantId, p, new Date(NOW.getTime() - 14 * DAY_MS));
    expect(await xpOf(p)).toBe(25);

    await addDays(p, [0, 1, 2, 3, 4, 5, 6]);
    await awardStreak(ctx.db, tenantId, p, NOW);
    expect(await xpOf(p)).toBe(50);
    expect(await jokersOf(p)).toHaveLength(2);
  });

  it('çift joker kısıtı: aynı kaynak iki kez yazılamaz', async () => {
    const p = await newPlayer();
    await ctx.db.insert(xpJokers).values({ tenantId, playerId: p, sourceId: 'x:7' });
    await expect(
      ctx.db.insert(xpJokers).values({ tenantId, playerId: p, sourceId: 'x:7' }),
    ).rejects.toThrow();
  });
});

describe('joker etkinleştirme', () => {
  const giveJokers = (playerId: string, n: number) =>
    ctx.db
      .insert(xpJokers)
      .values(Array.from({ length: n }, (_, i) => ({ tenantId, playerId, sourceId: `t:${i}` })));

  it('joker yoksa reddedilir', async () => {
    const p = await newPlayer();
    await expect(ctx.db.transaction((tx) => activateJoker(tx, tenantId, p, NOW))).rejects.toMatchObject({
      status: 409,
    });
  });

  it('etkinleştirince 7 gün sürer, ikinci joker etkinken kullanılamaz', async () => {
    const p = await newPlayer();
    await giveJokers(p, 2);
    await ctx.db.transaction((tx) => activateJoker(tx, tenantId, p, NOW));
    const view = await streakView(ctx.db, tenantId, p, NOW);
    expect(view.joker).toEqual({
      available: 1,
      activeUntil: new Date(NOW.getTime() + 7 * DAY_MS).toISOString(),
    });

    await expect(ctx.db.transaction((tx) => activateJoker(tx, tenantId, p, NOW))).rejects.toMatchObject({
      status: 409,
    });
    // 7 gün sonra süre doldu, ikincisi kullanılabilir.
    await ctx.db.transaction((tx) => activateJoker(tx, tenantId, p, new Date(NOW.getTime() + 7 * DAY_MS)));
    expect((await jokersOf(p)).filter((j) => j.activatedAt)).toHaveLength(2);
  });

  it('eşzamanlı 8 etkinleştirmede yalnızca biri geçer, süreler üst üste binmez', async () => {
    const p = await newPlayer();
    await giveJokers(p, 3);
    // Bağlantı havuzunu ısıt: işlemler gerçekten aynı anda başlasın.
    await Promise.all(Array.from({ length: 8 }, () => ctx.db.execute(sql`select pg_sleep(0.05)`)));

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => ctx.db.transaction((tx) => activateJoker(tx, tenantId, p, NOW))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await jokersOf(p)).filter((j) => j.activatedAt)).toHaveLength(1);
  });

  it('başka tenant üzerinden etkinleştirilemez (NFR-03)', async () => {
    const p = await newPlayer();
    await giveJokers(p, 1);
    await expect(ctx.db.transaction((tx) => activateJoker(tx, otherTenantId, p, NOW))).rejects.toMatchObject({
      status: 404,
    });
    expect((await jokersOf(p)).filter((j) => j.activatedAt)).toHaveLength(0);
  });

  it('etkin aralık yarı açık: başlangıç dahil, bitiş hariç', async () => {
    const p = await newPlayer();
    await giveJokers(p, 1);
    await ctx.db.transaction((tx) => activateJoker(tx, tenantId, p, NOW));
    const end = new Date(NOW.getTime() + 7 * DAY_MS);
    expect(await jokerActiveAt(ctx.db, tenantId, p, new Date(NOW.getTime() - 1))).toBe(false);
    expect(await jokerActiveAt(ctx.db, tenantId, p, NOW)).toBe(true);
    expect(await jokerActiveAt(ctx.db, tenantId, p, new Date(end.getTime() - 1))).toBe(true);
    expect(await jokerActiveAt(ctx.db, tenantId, p, end)).toBe(false);
  });
});

describe('XP jokeri görev XP sini 2 katlar', () => {
  let questId: string;
  beforeAll(async () => {
    const [q] = await ctx.db
      .insert(quests)
      .values({ tenantId, template: 'join_league', period: 'once', targetCount: 1, xpReward: 40 })
      .returning({ id: quests.id });
    questId = q!.id;
  });

  const member = async (p: string) => {
    await ctx.db.insert(memberships).values({ leagueId, playerId: p, cash: '1000.00' });
  };

  it('joker yokken görev XP si tek', async () => {
    const p = await newPlayer();
    await member(p);
    await evaluatePlayerQuests(ctx.db, tenantId, p, NOW);
    expect(await xpOf(p)).toBe(40);
  });

  it('joker etkinken tamamlanan görev 2 kat verir, tekrar değerlendirme bonusu çoğaltmaz', async () => {
    const p = await newPlayer();
    await ctx.db.insert(xpJokers).values({ tenantId, playerId: p, sourceId: 'b:7' });
    await ctx.db.transaction((tx) => activateJoker(tx, tenantId, p, NOW));
    await member(p);

    await evaluatePlayerQuests(ctx.db, tenantId, p, NOW);
    await evaluatePlayerQuests(ctx.db, tenantId, p, NOW);
    await evaluatePlayerQuests(ctx.db, tenantId, p, NOW);
    expect(await xpOf(p)).toBe(80);
    const bonus = await ctx.db
      .select()
      .from(xpLedger)
      .where(and(eq(xpLedger.playerId, p), eq(xpLedger.reason, 'joker_bonus')));
    expect(bonus).toHaveLength(1);
  });

  it('görev joker etkinleşmeden önce tamamlandıysa sonradan bonus gelmez', async () => {
    const p = await newPlayer();
    await member(p);
    await evaluatePlayerQuests(ctx.db, tenantId, p, NOW);
    await ctx.db.insert(xpJokers).values({ tenantId, playerId: p, sourceId: 'c:7' });
    await ctx.db.transaction((tx) => activateJoker(tx, tenantId, p, new Date(NOW.getTime() + 1000)));
    await evaluatePlayerQuests(ctx.db, tenantId, p, new Date(NOW.getTime() + 2000));
    expect(await xpOf(p)).toBe(40);
  });

  it('joker süresi dolduktan sonra tamamlanan görev tek verir', async () => {
    const p = await newPlayer();
    await ctx.db.insert(xpJokers).values({ tenantId, playerId: p, sourceId: 'd:7' });
    await ctx.db.transaction((tx) => activateJoker(tx, tenantId, p, new Date(NOW.getTime() - 8 * DAY_MS)));
    await member(p);
    await evaluatePlayerQuests(ctx.db, tenantId, p, NOW);
    expect(await xpOf(p)).toBe(40);
    expect(questId).toBeTruthy();
  });
});
