import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets, leagues, memberships, players } from '../db/schema';
import {
  connectIntegration,
  createTenant,
  deleteTenants,
  type IntegrationContext,
} from '../test/integration.test-utils';
import { DrizzleLeagueRepository } from './drizzle-league.repository';

let ctx: IntegrationContext;
let repo: DrizzleLeagueRepository;
let tenantA: string;
let tenantB: string;
let playerA: string;
let playerA2: string;
let playerB: string;

const NOW = new Date('2027-01-14T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

async function addLeague(
  tenantId: string,
  values: Partial<typeof leagues.$inferInsert> = {},
): Promise<string> {
  const [row] = await ctx.db
    .insert(leagues)
    .values({
      tenantId,
      name: 'Lig',
      type: 'weekly',
      status: 'active',
      startsAt: at(-3),
      endsAt: at(4),
      startingCash: '100000.00',
      assetIds: [],
      ...values,
    })
    .returning({ id: leagues.id });
  return row!.id;
}

async function addPlayer(tenantId: string): Promise<string> {
  const [row] = await ctx.db
    .insert(players)
    .values({ tenantId, externalId: randomUUID(), displayName: 'Test' })
    .returning({ id: players.id });
  return row!.id;
}

beforeAll(async () => {
  ctx = connectIntegration();
  repo = new DrizzleLeagueRepository(ctx.db);
  tenantA = await createTenant(ctx.db, 'league-int-a');
  tenantB = await createTenant(ctx.db, 'league-int-b');
  playerA = await addPlayer(tenantA);
  playerA2 = await addPlayer(tenantA);
  playerB = await addPlayer(tenantB);
});

afterAll(async () => {
  await deleteTenants(ctx.db, [tenantA, tenantB]);
  await ctx.close();
});

describe('DrizzleLeagueRepository (integration)', () => {
  it('lists visible leagues with member counts and filters out hidden ones (T4)', async () => {
    const visible = await addLeague(tenantA, { name: 'visible' });
    const recentFinished = await addLeague(tenantA, {
      status: 'finished',
      startsAt: at(-10),
      endsAt: at(-3),
    });
    await addLeague(tenantA, { status: 'finished', startsAt: at(-60), endsAt: at(-45) });
    await addLeague(tenantA, { status: 'draft' });
    await addLeague(tenantA, { type: 'friends' });
    await addLeague(tenantB, { name: 'other tenant' });

    await repo.createMembership(tenantA, visible, playerA2, NOW);

    const rows = await repo.listVisible(tenantA, playerA, NOW);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(visible);
    expect(ids).toContain(recentFinished);
    expect(rows).toHaveLength(2);

    const row = rows.find((r) => r.id === visible)!;
    expect(row).toMatchObject({ memberCount: 1, joined: false, startingCash: '100000.00' });
    expect(row.startsAt).toBeInstanceOf(Date);

    const asMember = (await repo.listVisible(tenantA, playerA2, NOW)).find((r) => r.id === visible);
    expect(asMember).toMatchObject({ memberCount: 1, joined: true });
    expect(await repo.findVisible(tenantA, visible, playerA2)).toMatchObject({
      memberCount: 1,
      joined: true,
    });
  });

  it('findVisible hides drafts and other tenants', async () => {
    const draft = await addLeague(tenantA, { status: 'draft' });
    const foreign = await addLeague(tenantB);
    expect(await repo.findVisible(tenantA, draft, playerA)).toBeNull();
    expect(await repo.findVisible(tenantA, foreign, playerA)).toBeNull();
    expect(await repo.findVisible(tenantB, foreign, playerB)).not.toBeNull();
  });

  it('findAssets never returns another tenant its assets', async () => {
    const [own] = await ctx.db
      .insert(assets)
      .values({ tenantId: tenantA, symbol: `A${Date.now()}`, name: 'A', assetClass: 'crypto' })
      .returning({ id: assets.id });
    const [foreign] = await ctx.db
      .insert(assets)
      .values({ tenantId: tenantB, symbol: `B${Date.now()}`, name: 'B', assetClass: 'crypto' })
      .returning({ id: assets.id });
    const found = await repo.findAssets(tenantA, [own!.id, foreign!.id]);
    expect(found.map((a) => a.id)).toEqual([own!.id]);
  });

  it('creates a membership with the league starting cash', async () => {
    const league = await addLeague(tenantA, { startingCash: '25000.50' });
    const membership = await repo.createMembership(tenantA, league, playerA, NOW);
    expect(membership).toMatchObject({ leagueId: league, playerId: playerA, cash: '25000.50' });
    expect(membership!.joinedAt).toBeInstanceOf(Date);
    expect(await repo.findMembership(league, playerA)).toMatchObject({ id: membership!.id });
  });

  it.each([
    [
      'a second join',
      async () => {
        const id = await addLeague(tenantA);
        await repo.createMembership(tenantA, id, playerA, NOW);
        return { league: id, tenant: tenantA, player: playerA };
      },
    ],
    [
      'an ended league',
      async () => ({
        league: await addLeague(tenantA, { startsAt: at(-7), endsAt: at(0) }),
        tenant: tenantA,
        player: playerA,
      }),
    ],
    [
      'a finished league',
      async () => ({
        league: await addLeague(tenantA, { status: 'finished' }),
        tenant: tenantA,
        player: playerA,
      }),
    ],
    [
      'a draft league',
      async () => ({
        league: await addLeague(tenantA, { status: 'draft' }),
        tenant: tenantA,
        player: playerA,
      }),
    ],
    [
      'a friends league',
      async () => ({
        league: await addLeague(tenantA, { type: 'friends' }),
        tenant: tenantA,
        player: playerA,
      }),
    ],
    [
      "another tenant's league",
      async () => ({ league: await addLeague(tenantB), tenant: tenantA, player: playerA }),
    ],
    [
      'a player from another tenant',
      async () => ({ league: await addLeague(tenantA), tenant: tenantA, player: playerB }),
    ],
  ])('refuses %s', async (_label, arrange) => {
    const { league, tenant, player } = await arrange();
    expect(await repo.createMembership(tenant, league, player, NOW)).toBeNull();
  });

  it('creates exactly one membership when the same join arrives 20 times in parallel (T3)', async () => {
    const league = await addLeague(tenantA);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => repo.createMembership(tenantA, league, playerA, NOW)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const rows = await ctx.db.select().from(memberships).where(eq(memberships.leagueId, league));
    expect(rows).toHaveLength(1);
  });

  it('cannot join once an admin closes the league, even with a stale read of it', async () => {
    const league = await addLeague(tenantA);
    const seen = await repo.findVisible(tenantA, league, playerA);
    expect(seen?.status).toBe('active');

    await ctx.db.update(leagues).set({ status: 'finished' }).where(eq(leagues.id, league));
    expect(await repo.createMembership(tenantA, league, playerA, NOW)).toBeNull();
  });
});
