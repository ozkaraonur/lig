import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets, leagues, memberships, players, quests, virtualOrders } from '../db/schema';
import {
  connectIntegration,
  createTenant,
  deleteTenants,
  type IntegrationContext,
} from '../test/integration.test-utils';
import { evaluatePlayerQuests, QuestsService } from './quest-evaluator';
import { questStore } from './quest-store';

/** "N farklı sektörden varlık al" görevi, gerçek PostgreSQL ile (Faz 3, 1. adım). */
let ctx: IntegrationContext;
let tenantId: string;
let otherTenantId: string;
let leagueId: string;
let questId: string;
const asset = { bank1: '', bank2: '', energy: '', defense: '', crypto: '', foreign: '' };

const NOW = new Date('2026-09-23T09:00:00Z'); // çarşamba, haftanın içi

async function newPlayer() {
  const [player] = await ctx.db
    .insert(players)
    .values({ tenantId, externalId: `s-${randomUUID()}`, displayName: 'Sektör' })
    .returning({ id: players.id });
  const [member] = await ctx.db
    .insert(memberships)
    .values({ leagueId, playerId: player!.id, cash: '1000.00' })
    .returning({ id: memberships.id });
  return { playerId: player!.id, membershipId: member!.id };
}

async function order(
  membershipId: string,
  assetId: string,
  side: 'buy' | 'sell',
  createdAt: Date = NOW,
): Promise<void> {
  await ctx.db.insert(virtualOrders).values({
    membershipId,
    assetId,
    side,
    amount: '10.00',
    price: '10',
    quantity: '1',
    idempotencyKey: randomUUID(),
    requestHash: 'test',
    createdAt,
  });
}

const count = (playerId: string) =>
  questStore.count(ctx.db, 'buy_distinct_sectors', tenantId, playerId, {
    key: '2026-W39',
    start: new Date('2026-09-20T21:00:00Z'), // pazartesi 00:00 TR
    end: new Date('2026-09-27T21:00:00Z'),
  });

beforeAll(async () => {
  ctx = connectIntegration();
  tenantId = await createTenant(ctx.db, 'sector-quest');
  otherTenantId = await createTenant(ctx.db, 'sector-quest-other');
  const rows = await ctx.db
    .insert(assets)
    .values([
      { tenantId, symbol: 'BNK1', name: 'Banka 1', assetClass: 'equity', sector: 'Bankacılık' },
      { tenantId, symbol: 'BNK2', name: 'Banka 2', assetClass: 'equity', sector: 'Bankacılık' },
      { tenantId, symbol: 'ENRJ', name: 'Enerji', assetClass: 'equity', sector: 'Enerji' },
      { tenantId, symbol: 'SVNM', name: 'Savunma', assetClass: 'equity', sector: 'Savunma' },
      { tenantId, symbol: 'KRPT', name: 'Kripto', assetClass: 'crypto' },
      { tenantId: otherTenantId, symbol: 'YBNC', name: 'Yabancı', assetClass: 'equity', sector: 'Turizm' },
    ])
    .returning({ id: assets.id, symbol: assets.symbol });
  const bySymbol = new Map(rows.map((r) => [r.symbol, r.id]));
  asset.bank1 = bySymbol.get('BNK1')!;
  asset.bank2 = bySymbol.get('BNK2')!;
  asset.energy = bySymbol.get('ENRJ')!;
  asset.defense = bySymbol.get('SVNM')!;
  asset.crypto = bySymbol.get('KRPT')!;
  asset.foreign = bySymbol.get('YBNC')!;

  const [league] = await ctx.db
    .insert(leagues)
    .values({
      tenantId,
      name: 'sector-int',
      type: 'weekly',
      status: 'active',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2026-10-30T00:00:00Z'),
      startingCash: '1000.00',
      assetIds: [asset.bank1, asset.bank2, asset.energy, asset.defense, asset.crypto],
    })
    .returning({ id: leagues.id });
  leagueId = league!.id;

  const [quest] = await ctx.db
    .insert(quests)
    .values({ tenantId, template: 'buy_distinct_sectors', period: 'weekly', targetCount: 3, xpReward: 150 })
    .returning({ id: quests.id });
  questId = quest!.id;
});

afterAll(async () => {
  await deleteTenants(ctx.db, [tenantId, otherTenantId]);
  await ctx.close();
});

describe('buy_distinct_sectors sayımı', () => {
  it('aynı sektörden birden çok alış tek sektör sayılır', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank1, 'buy');
    await order(p.membershipId, asset.bank2, 'buy');
    await order(p.membershipId, asset.bank1, 'buy');
    expect(await count(p.playerId)).toBe(1);
  });

  it('farklı sektörlerden alışlar ayrı ayrı sayılır', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank1, 'buy');
    await order(p.membershipId, asset.energy, 'buy');
    await order(p.membershipId, asset.defense, 'buy');
    expect(await count(p.playerId)).toBe(3);
  });

  it('satış sayılmaz', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank1, 'buy');
    await order(p.membershipId, asset.energy, 'sell');
    await order(p.membershipId, asset.defense, 'sell');
    expect(await count(p.playerId)).toBe(1);
  });

  it('sektörü olmayan (kripto) varlık sayılmaz', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.crypto, 'buy');
    expect(await count(p.playerId)).toBe(0);
  });

  it('hafta dışındaki alış sayılmaz', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank1, 'buy', new Date('2026-09-20T20:59:00Z')); // pazar 23:59 TR
    await order(p.membershipId, asset.energy, 'buy', new Date('2026-09-27T21:00:00Z')); // sonraki pazartesi 00:00
    expect(await count(p.playerId)).toBe(0);
  });

  it('başka platformun varlığı sayılmaz', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank1, 'buy');
    await order(p.membershipId, asset.foreign, 'buy');
    expect(await count(p.playerId)).toBe(1);
  });

  it('başka oyuncunun alışı sayılmaz', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await order(a.membershipId, asset.energy, 'buy');
    expect(await count(b.playerId)).toBe(0);
  });
});

describe('buy_distinct_sectors görevi', () => {
  it('hedefe ulaşınca XP bir kez verilir, eşzamanlı değerlendirmede de', async () => {
    const p = await newPlayer();
    await order(p.membershipId, asset.bank1, 'buy');
    await order(p.membershipId, asset.energy, 'buy');
    const before = await new QuestsService(ctx.db).listForPlayer(tenantId, p.playerId, NOW);
    expect(before.find((q) => q.template === 'buy_distinct_sectors')).toMatchObject({
      title: 'Bu hafta 3 farklı sektörden varlık al',
      progress: 2,
      completed: false,
    });

    await order(p.membershipId, asset.defense, 'buy');
    const results = await Promise.all(
      Array.from({ length: 8 }, () => evaluatePlayerQuests(ctx.db, tenantId, p.playerId, NOW)),
    );
    expect(results.reduce((sum, r) => sum + r.xpGranted, 0)).toBe(150);
    expect(results.filter((r) => r.completed.includes(questId))).toHaveLength(1);
    const [row] = await ctx.db.select({ xp: players.xp }).from(players).where(eq(players.id, p.playerId));
    expect(row?.xp).toBe(150);
  });
});
