import { SESSION_COOKIE_NAME } from '@lig/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../app.setup';
import { InMemoryRateLimiter, InMemorySessionStore } from '../auth/fakes.test-utils';
import { PlayerRateLimitGuard } from '../auth/player-rate-limit.guard';
import { RATE_LIMITER, SESSION_STORE } from '../auth/ports';
import { SessionGuard } from '../auth/session.guard';
import { CLOCK_MS } from '../common/clock';
import { APPEARANCE_READER, type PlayerAppearance } from '../gamification/ports';
import { InMemoryLeagueRepository, type StoredLeague } from '../leagues/fakes.test-utils';
import { LEAGUE_REPOSITORY } from '../leagues/ports';
import { InMemoryPriceStore } from '../prices/fakes.test-utils';
import { PRICE_STORE } from '../prices/ports';
import { PriceService } from '../prices/price.service';
import {
  FINAL_STANDINGS_READER,
  type FinalStandingRow,
  type FinalStandingsReader,
  RANKING_SOURCE,
  RANKING_STORE,
  type RankingStore,
  type StoredRankEntry,
} from './ports';
import { RankingController } from './ranking.controller';
import { RankingService } from './ranking.service';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

class FakeRankingStore implements Partial<RankingStore> {
  entries = new Map<string, StoredRankEntry[]>();
  async top(leagueId: string, limit: number) {
    return (this.entries.get(leagueId) ?? []).slice(0, limit);
  }
  async entryFor(leagueId: string, playerId: string) {
    return (this.entries.get(leagueId) ?? []).find((e) => e.playerId === playerId) ?? null;
  }
  async count(leagueId: string) {
    return (this.entries.get(leagueId) ?? []).length;
  }
  async updatedAt() {
    return 1_800_000_000_000;
  }
}

class FakeFinals implements FinalStandingsReader {
  rows = new Map<string, FinalStandingRow[]>();
  async top(leagueId: string, limit: number) {
    return (this.rows.get(leagueId) ?? []).slice(0, limit);
  }
  async entryFor(leagueId: string, playerId: string) {
    return (this.rows.get(leagueId) ?? []).find((r) => r.playerId === playerId) ?? null;
  }
  async count(leagueId: string) {
    return (this.rows.get(leagueId) ?? []).length;
  }
  async xpAwarded() {
    return 400;
  }
}

let app: NestFastifyApplication;
let repo: InMemoryLeagueRepository;
let sessions: InMemorySessionStore;
let store: FakeRankingStore;
let finals: FakeFinals;
let running: StoredLeague;
let finished: StoredLeague;
let me: string;
let cookie: Record<string, string>;
let looks: Map<string, PlayerAppearance>;

beforeEach(async () => {
  repo = new InMemoryLeagueRepository();
  sessions = new InMemorySessionStore();
  store = new FakeRankingStore();
  finals = new FakeFinals();
  running = repo.addLeague({ tenantId: TENANT_A, startingCash: '1000.00' });
  finished = repo.addLeague({ tenantId: TENANT_A, status: 'finished', startingCash: '1000.00' });
  me = repo.addPlayer(TENANT_A);
  const other = repo.addPlayer(TENANT_A);
  for (const league of [running, finished]) {
    repo.memberships.push({
      id: `${league.id}-me`,
      leagueId: league.id,
      playerId: me,
      cash: '0',
      joinedAt: new Date(),
    });
  }
  store.entries.set(running.id, [
    { playerId: other, valueUnits: 150_000n, rank: 1 },
    { playerId: me, valueUnits: 90_000n, rank: 2 },
  ]);
  finals.rows.set(finished.id, [
    { playerId: other, displayName: 'Rakip', finalRank: 1, finalValue: '1500.00' },
    { playerId: me, displayName: 'Ben', finalRank: 2, finalValue: '900.00' },
  ]);
  cookie = {
    [SESSION_COOKIE_NAME]: await sessions.create({ tenantId: TENANT_A, playerId: me, createdAt: 0 }),
  };

  looks = new Map<string, PlayerAppearance>([
    [me, { xp: 0, selectedTitle: null, selectedFrame: null }],
    [other, { xp: 700, selectedTitle: null, selectedFrame: 'laurel' }],
  ]);
  const names = new Map([
    [me, 'Ben'],
    [other, 'Rakip'],
  ]);
  const moduleRef = await Test.createTestingModule({
    controllers: [RankingController],
    providers: [
      RankingService,
      PriceService,
      SessionGuard,
      PlayerRateLimitGuard,
      { provide: CLOCK_MS, useValue: () => 1_800_000_000_000 },
      { provide: LEAGUE_REPOSITORY, useValue: repo },
      { provide: RANKING_STORE, useValue: store },
      { provide: FINAL_STANDINGS_READER, useValue: finals },
      { provide: RANKING_SOURCE, useValue: { displayNames: async () => names } },
      { provide: APPEARANCE_READER, useValue: { find: async () => looks } },
      { provide: PRICE_STORE, useValue: new InMemoryPriceStore() },
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

const get = (leagueId: string, query = '', cookies: Record<string, string> = cookie) =>
  app.inject({ method: 'GET', url: `/leagues/${leagueId}/leaderboard${query}`, cookies });

describe('GET /leagues/:id/leaderboard', () => {
  it('requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: `/leagues/${running.id}/leaderboard` });
    expect(res.statusCode).toBe(401);
  });

  it('returns the live top list with my row and returns computed from the starting cash', async () => {
    const res = await get(running.id);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      leaderboard: {
        final: false,
        updatedAt: new Date(1_800_000_000_000).toISOString(),
        playerCount: 2,
        top: [
          {
            rank: 1,
            displayName: 'Rakip',
            title: 'Deneyimli Yatırımcı',
            frame: 'laurel',
            totalValue: '1500.00',
            returnPercent: '50.00',
            isMe: false,
          },
          {
            rank: 2,
            displayName: 'Ben',
            title: 'Çaylak',
            frame: null,
            totalValue: '900.00',
            returnPercent: '-10.00',
            isMe: true,
          },
        ],
        me: {
          rank: 2,
          displayName: 'Ben',
          title: 'Çaylak',
          frame: null,
          totalValue: '900.00',
          returnPercent: '-10.00',
          isMe: true,
          xpAwarded: null,
        },
      },
    });
  });

  it('never exposes internal player ids', async () => {
    const body = (await get(running.id)).body;
    expect(body).not.toContain(me);
  });

  it('serves frozen standings and my XP for a finished league', async () => {
    expect((await get(finished.id)).json()).toMatchObject({
      leaderboard: { final: true, top: [{ rank: 1 }, { rank: 2, isMe: true }], me: { xpAwarded: 400 } },
    });
  });

  it('shows a selected title only while its XP threshold is met', async () => {
    looks.set(me, { xp: 50, selectedTitle: 'market_wolf', selectedFrame: null });
    const body = (await get(running.id)).json() as { leaderboard: { me: { title: string } } };
    expect(body.leaderboard.me.title).toBe('Çaylak');

    looks.set(me, { xp: 5_000, selectedTitle: 'novice', selectedFrame: null });
    const chosen = (await get(running.id)).json() as { leaderboard: { me: { title: string } } };
    expect(chosen.leaderboard.me.title).toBe('Acemi Yatırımcı');
  });

  it('respects the limit', async () => {
    expect((await get(running.id, '?limit=1')).json()).toMatchObject({ leaderboard: { top: [{ rank: 1 }] } });
  });

  it.each(['?limit=0', '?limit=51', '?limit=x'])('rejects %s', async (q) => {
    expect((await get(running.id, q)).statusCode).toBe(400);
  });

  it("returns 404 for another tenant's or a draft league (T4)", async () => {
    const foreign = repo.addLeague({ tenantId: TENANT_B });
    const draft = repo.addLeague({ tenantId: TENANT_A, status: 'draft' });
    expect((await get(foreign.id)).statusCode).toBe(404);
    expect((await get(draft.id)).statusCode).toBe(404);
  });
});
