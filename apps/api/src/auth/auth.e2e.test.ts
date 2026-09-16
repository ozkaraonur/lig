import { SESSION_COOKIE_NAME } from '@lig/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../app.setup';
import { AuthController } from './auth.controller';
import { AuthService, LOGIN_RATE_LIMIT } from './auth.service';
import {
  createTestPlatform,
  fixedClock,
  InMemoryPlayerRepository,
  InMemoryRateLimiter,
  InMemoryReplayStore,
  InMemorySessionStore,
  InMemoryTenantDirectory,
  type TestPlatform,
} from './fakes.test-utils';
import { PlayerTokenVerifier } from './player-token.verifier';
import {
  CLOCK,
  PLAYER_REPOSITORY,
  RATE_LIMITER,
  REPLAY_STORE,
  SESSION_STORE,
  TENANT_DIRECTORY,
} from './ports';
import { SessionGuard } from './session.guard';

const TENANT = '33333333-3333-4333-8333-333333333333';
let platform: TestPlatform;
let app: NestFastifyApplication;
let sessions: InMemorySessionStore;

beforeAll(async () => {
  platform = await createTestPlatform(TENANT, 'platform-e2e');
});

beforeEach(async () => {
  sessions = new InMemorySessionStore();
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      AuthService,
      PlayerTokenVerifier,
      SessionGuard,
      { provide: CLOCK, useValue: fixedClock },
      { provide: TENANT_DIRECTORY, useValue: new InMemoryTenantDirectory([platform.tenant]) },
      { provide: REPLAY_STORE, useValue: new InMemoryReplayStore() },
      { provide: SESSION_STORE, useValue: sessions },
      { provide: RATE_LIMITER, useValue: new InMemoryRateLimiter() },
      { provide: PLAYER_REPOSITORY, useValue: new InMemoryPlayerRepository() },
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

function sessionCookieFrom(res: { cookies: Array<{ name: string; value: string }> }) {
  return res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
}

async function login(token?: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/session',
    payload: { token: token ?? (await platform.sign({ name: 'Ece' })) },
  });
}

describe('POST /auth/session', () => {
  it('sets a hardened session cookie and returns the player', async () => {
    const res = await login();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ player: { displayName: 'Ece' } });
    expect(res.headers['cache-control']).toBe('no-store');

    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\//i);
  });

  it('never echoes the platform token or session token in the body', async () => {
    const token = await platform.sign();
    const res = await login(token);
    const cookie = sessionCookieFrom(res);
    expect(res.body).not.toContain(token);
    expect(res.body).not.toContain(cookie?.value ?? 'missing');
  });

  it('rejects an invalid token with a generic error and no cookie', async () => {
    const res = await login('eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'INVALID_TOKEN', message: expect.any(String) });
    expect(sessionCookieFrom(res)).toBeUndefined();
  });

  it('rejects a replayed token', async () => {
    const token = await platform.sign();
    expect((await login(token)).statusCode).toBe(200);
    expect((await login(token)).statusCode).toBe(401);
  });

  it('validates the body', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/session', payload: { nope: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rate limits login attempts per IP', async () => {
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit; i++) {
      await login('x'.repeat(30));
    }
    const res = await login('x'.repeat(30));
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('GET /auth/me', () => {
  it('returns 401 without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('returns 401 with a forged session cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [SESSION_COOKIE_NAME]: 'forged' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the player with a valid session', async () => {
    const cookie = sessionCookieFrom(await login());
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [SESSION_COOKIE_NAME]: cookie!.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ player: { displayName: 'Ece' } });
  });
});

describe('POST /auth/logout', () => {
  it('destroys the session and clears the cookie', async () => {
    const cookie = sessionCookieFrom(await login());
    const cookies = { [SESSION_COOKIE_NAME]: cookie!.value };

    const res = await app.inject({ method: 'POST', url: '/auth/logout', cookies });
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(new RegExp(`${SESSION_COOKIE_NAME}=;`));
    expect(sessions.sessions.size).toBe(0);

    const after = await app.inject({ method: 'GET', url: '/auth/me', cookies });
    expect(after.statusCode).toBe(401);
  });
});
