import { SESSION_COOKIE_NAME, type ProfileView } from '@lig/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../app.setup';
import { InMemoryRateLimiter, InMemorySessionStore } from '../auth/fakes.test-utils';
import { PlayerRateLimitGuard } from '../auth/player-rate-limit.guard';
import { RATE_LIMITER, SESSION_STORE } from '../auth/ports';
import { SessionGuard } from '../auth/session.guard';
import { InMemoryProfileRepository } from './fakes.test-utils';
import { PROFILE_REPOSITORY } from './ports';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

let app: NestFastifyApplication;
let repo: InMemoryProfileRepository;
let sessions: InMemorySessionStore;
let cookie: Record<string, string>;

beforeEach(async () => {
  repo = new InMemoryProfileRepository();
  sessions = new InMemorySessionStore();
  repo.addPlayer(ME, TENANT_A, 600, ['first_order', 'podium']);
  repo.addPlayer(OTHER, TENANT_A, 9_000, ['limit_up_hunter']);
  cookie = {
    [SESSION_COOKIE_NAME]: await sessions.create({ tenantId: TENANT_A, playerId: ME, createdAt: 0 }),
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [ProfileController],
    providers: [
      ProfileService,
      SessionGuard,
      PlayerRateLimitGuard,
      { provide: PROFILE_REPOSITORY, useValue: repo },
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

const getProfile = (cookies: Record<string, string> = cookie) =>
  app.inject({ method: 'GET', url: '/profile', cookies });
const put = (body: unknown, cookies: Record<string, string> = cookie) =>
  app.inject({ method: 'PUT', url: '/profile/appearance', cookies, payload: body as object });

const profileOf = (res: { json(): unknown }) => (res.json() as { profile: ProfileView }).profile;

describe('GET /profile', () => {
  it('requires a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/profile' })).statusCode).toBe(401);
  });

  it('lists every badge with earned state, and derives titles from XP', async () => {
    const res = await getProfile();
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const profile = profileOf(res);

    expect(profile.badges.map((b) => b.name)).toContain('Tavan Avcısı');
    expect(profile.badges.filter((b) => b.earned).map((b) => b.id)).toEqual(['first_order', 'podium']);
    expect(profile.badges.find((b) => b.id === 'first_order')?.earnedAt).toBe('2027-01-12T10:00:00.000Z');
    expect(profile.badges.find((b) => b.id === 'quest_hunter')?.earnedAt).toBeNull();

    // 600 XP: Çaylak, Acemi, Deneyimli açık; en yükseği görünür.
    expect(profile.titles.filter((t) => t.owned).map((t) => t.id)).toEqual([
      'rookie',
      'novice',
      'experienced',
    ]);
    expect(profile.titles.filter((t) => t.selected).map((t) => t.id)).toEqual(['experienced']);
    // Çerçeve rozetle açılır.
    expect(profile.frames.filter((f) => f.owned).map((f) => f.id)).toEqual(['starter', 'laurel']);
    expect(profile.frames.some((f) => f.selected)).toBe(false);
  });

  it('never shows another tenant its own player (T4)', async () => {
    const foreign = {
      [SESSION_COOKIE_NAME]: await sessions.create({ tenantId: TENANT_B, playerId: ME, createdAt: 0 }),
    };
    expect((await getProfile(foreign)).statusCode).toBe(404);
  });
});

describe('PUT /profile/appearance', () => {
  it('selects an owned title and frame', async () => {
    const res = await put({ title: 'novice', frame: 'laurel' });
    expect(res.statusCode).toBe(200);
    const profile = profileOf(res);
    expect(profile.titles.find((t) => t.selected)?.id).toBe('novice');
    expect(profile.frames.find((f) => f.selected)?.id).toBe('laurel');
  });

  it('rejects a frame the player has not earned and writes nothing', async () => {
    const res = await put({ frame: 'limit_up' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(repo.writes).toBe(0);
  });

  it("rejects another player's frame even when it is a real frame id", async () => {
    // OTHER 'Tavan Avcısı'nı kazandı, ME kazanmadı.
    expect((await put({ frame: 'limit_up' })).statusCode).toBe(403);
    expect(repo.players.get(ME)?.selectedFrame).toBeNull();
  });

  it('rejects a title whose XP threshold is not reached', async () => {
    expect((await put({ title: 'market_wolf' })).statusCode).toBe(403);
    expect(repo.players.get(ME)?.selectedTitle).toBeNull();
  });

  it('is all-or-nothing: an owned title is not written when the frame is not owned', async () => {
    expect((await put({ title: 'novice', frame: 'limit_up' })).statusCode).toBe(403);
    expect(repo.players.get(ME)?.selectedTitle).toBeNull();
    expect(repo.writes).toBe(0);
  });

  it('clears a selection with null', async () => {
    await put({ frame: 'laurel' });
    const profile = profileOf(await put({ frame: null }));
    expect(profile.frames.some((f) => f.selected)).toBe(false);
  });

  it('only ever changes the session player, ignoring a player id in the body', async () => {
    const res = await put({ frame: 'laurel', playerId: OTHER });
    expect(res.statusCode).toBe(400);
    expect(repo.players.get(OTHER)?.selectedFrame).toBeNull();
  });

  it.each([{}, { frame: 'altin' }, { title: 'yok' }, { xp: 999 }, { frame: 5 }])(
    'rejects invalid body %j',
    async (body) => {
      expect((await put(body)).statusCode).toBe(400);
    },
  );

  it('requires a session', async () => {
    const res = await app.inject({ method: 'PUT', url: '/profile/appearance', payload: { frame: null } });
    expect(res.statusCode).toBe(401);
  });

  it('rate limits writes per player', async () => {
    let last = 200;
    for (let i = 0; i < 25; i += 1) last = (await put({ frame: null })).statusCode;
    expect(last).toBe(429);
  });
});
