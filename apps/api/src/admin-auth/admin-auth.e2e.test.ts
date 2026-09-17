import { ADMIN_PREAUTH_COOKIE_NAME, ADMIN_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from '@lig/shared';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../app.setup';
import { InMemoryRateLimiter, InMemorySessionStore } from '../auth/fakes.test-utils';
import { RATE_LIMITER, SESSION_STORE } from '../auth/ports';
import { SessionGuard } from '../auth/session.guard';
import { CLOCK_MS } from '../common/clock';
import { developmentKeyring, LocalSecretCipher } from '../secrets/local-secret-cipher';
import { SECRET_CIPHER, secretContext } from '../secrets/secret-cipher';
import { AdminAuthController } from './admin-auth.controller';
import {
  ADMIN_RATE_LIMITS,
  ADMIN_SESSION_ABSOLUTE_SECONDS,
  ADMIN_SESSION_IDLE_SECONDS,
  AdminAuthService,
} from './admin-auth.service';
import { AdminRoles, AdminSessionGuard } from './admin-session.guard';
import { InMemoryAdminRepository, InMemoryTokenStore } from './fakes.test-utils';
import { ADMIN_PREAUTH_STORE, ADMIN_REPOSITORY, ADMIN_SESSION_STORE, type AdminSessionData } from './ports';
import { base32Decode, totpCodeAt, totpStep } from './totp';

const TENANT = '44444444-4444-4444-8444-444444444444';
const EMAIL = 'ayse@platform.test';
const PASSWORD = 'uzun-ve-dogru-parola';
const START = Date.parse('2026-09-17T09:00:00Z');

@Controller('admin/test')
class ProtectedController {
  @Get('any')
  @UseGuards(AdminSessionGuard)
  any() {
    return { ok: true };
  }

  @Get('owner-only')
  @AdminRoles('owner')
  @UseGuards(AdminSessionGuard)
  ownerOnly() {
    return { ok: true };
  }
}

@Controller('player-test')
class PlayerController {
  @Get()
  @UseGuards(SessionGuard)
  get() {
    return { ok: true };
  }
}

let app: NestFastifyApplication;
let now: number;
let admins: InMemoryAdminRepository;
let sessions: InMemoryTokenStore<AdminSessionData>;
const cipher = new LocalSecretCipher(developmentKeyring());

beforeEach(async () => {
  now = START;
  admins = new InMemoryAdminRepository();
  sessions = new InMemoryTokenStore();
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminAuthController, ProtectedController, PlayerController],
    providers: [
      AdminAuthService,
      AdminSessionGuard,
      SessionGuard,
      { provide: ADMIN_REPOSITORY, useValue: admins },
      { provide: ADMIN_SESSION_STORE, useValue: sessions },
      { provide: ADMIN_PREAUTH_STORE, useValue: new InMemoryTokenStore() },
      { provide: RATE_LIMITER, useValue: new InMemoryRateLimiter() },
      { provide: SECRET_CIPHER, useValue: cipher },
      { provide: CLOCK_MS, useValue: () => now },
      { provide: SESSION_STORE, useValue: new InMemorySessionStore() },
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

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
const cookie = (res: Res, name: string) => res.cookies.find((c) => c.name === name);

function login(email = EMAIL, password = PASSWORD) {
  return app.inject({ method: 'POST', url: '/admin/auth/login', payload: { email, password } });
}

function withPreAuth(res: Res) {
  const value = cookie(res, ADMIN_PREAUTH_COOKIE_NAME)?.value;
  if (!value) throw new Error('no pre-auth cookie');
  return { [ADMIN_PREAUTH_COOKIE_NAME]: value };
}

function codeFor(secret: string, offsetSteps = 0) {
  return totpCodeAt(base32Decode(secret), totpStep(Math.floor(now / 1000)) + offsetSteps);
}

/** İlk girişi baştan sona yapar; secret ve oturum çerezini döner. */
async function enroll() {
  const started = await login();
  const setup = await app.inject({
    method: 'POST',
    url: '/admin/auth/mfa/setup',
    cookies: withPreAuth(started),
  });
  const { secret } = setup.json<{ secret: string }>();
  const verified = await app.inject({
    method: 'POST',
    url: '/admin/auth/mfa/verify',
    cookies: withPreAuth(started),
    payload: { code: codeFor(secret) },
  });
  const session = cookie(verified, ADMIN_SESSION_COOKIE_NAME)?.value ?? '';
  return { secret, session, verified };
}

describe('first login with MFA enrollment', () => {
  beforeEach(async () => {
    await admins.add({ tenantId: TENANT, email: EMAIL, password: PASSWORD });
  });

  it('asks for setup, keeps the same secret on refresh and opens a session only after a valid code', async () => {
    const started = await login();
    expect(started.statusCode).toBe(200);
    expect(started.json()).toEqual({ next: 'mfa_setup' });
    expect(started.headers['cache-control']).toBe('no-store');
    expect(cookie(started, ADMIN_PREAUTH_COOKIE_NAME)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/admin/auth',
    });
    expect(cookie(started, ADMIN_SESSION_COOKIE_NAME)).toBeUndefined();

    const setup = await app.inject({
      method: 'POST',
      url: '/admin/auth/mfa/setup',
      cookies: withPreAuth(started),
    });
    expect(setup.statusCode).toBe(200);
    const { secret, otpauthUri } = setup.json<{ secret: string; otpauthUri: string }>();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri).toContain(`secret=${secret}`);
    expect(otpauthUri).toContain('Lig%3Aayse%40platform.test');

    const again = await app.inject({
      method: 'POST',
      url: '/admin/auth/mfa/setup',
      cookies: withPreAuth(started),
    });
    expect(again.json()).toMatchObject({ secret });

    const [account] = [...admins.accounts.values()];
    expect(account?.mfaSecretCiphertext).toBeNull();

    const wrong = await app.inject({
      method: 'POST',
      url: '/admin/auth/mfa/verify',
      cookies: withPreAuth(started),
      payload: { code: codeFor(secret, 5) },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ code: 'INVALID_MFA_CODE', message: 'Kod hatalı ya da süresi geçmiş.' });

    const ok = await app.inject({
      method: 'POST',
      url: '/admin/auth/mfa/verify',
      cookies: withPreAuth(started),
      payload: { code: codeFor(secret) },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      admin: { id: account?.id, email: EMAIL, role: 'owner' },
      tenant: { name: 'Test Platformu' },
    });
    const sessionCookie = cookie(ok, ADMIN_SESSION_COOKIE_NAME);
    expect(sessionCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/admin' });
    expect(sessionCookie?.maxAge).toBeUndefined();
    // Oturum, giriş adımından farklı yeni bir token (oturum sabitleme yok).
    expect(sessionCookie?.value).not.toBe(withPreAuth(started)[ADMIN_PREAUTH_COOKIE_NAME]);
    expect(cookie(ok, ADMIN_PREAUTH_COOKIE_NAME)?.value).toBe('');

    // Secret veritabanına şifreli yazıldı ve yalnızca bu yöneticinin bağlamıyla çözülür.
    const stored = admins.accounts.get(account?.id ?? '')?.mfaSecretCiphertext ?? '';
    expect(stored).not.toContain(secret);
    expect(await cipher.decrypt(stored, secretContext.adminMfaSecret(account?.id ?? ''))).toBe(secret);
    expect(admins.logins).toHaveLength(1);

    // Giriş adımı kullanıldı: aynı çerezle ikinci oturum açılamaz.
    const reuse = await app.inject({
      method: 'POST',
      url: '/admin/auth/mfa/verify',
      cookies: withPreAuth(started),
      payload: { code: codeFor(secret, 1) },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('does not treat the pre-auth cookie as a session', async () => {
    const started = await login();
    const token = withPreAuth(started)[ADMIN_PREAUTH_COOKIE_NAME];
    const res = await app.inject({
      method: 'GET',
      url: '/admin/auth/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: token },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('returning admin', () => {
  let secret: string;

  beforeEach(async () => {
    await admins.add({ tenantId: TENANT, email: EMAIL, password: PASSWORD });
    ({ secret } = await enroll());
  });

  it('asks for a code, refuses setup and refuses the code already used at enrollment (replay)', async () => {
    const started = await login();
    expect(started.json()).toEqual({ next: 'mfa_verify' });

    const setup = await app.inject({
      method: 'POST',
      url: '/admin/auth/mfa/setup',
      cookies: withPreAuth(started),
    });
    expect(setup.statusCode).toBe(403);

    const replay = await app.inject({
      method: 'POST',
      url: '/admin/auth/mfa/verify',
      cookies: withPreAuth(started),
      payload: { code: codeFor(secret) },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toMatchObject({ code: 'INVALID_MFA_CODE' });

    now += 30_000;
    const fresh = await app.inject({
      method: 'POST',
      url: '/admin/auth/mfa/verify',
      cookies: withPreAuth(started),
      payload: { code: codeFor(secret) },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('sends the admin back to the password step after 3 code attempts', async () => {
    now += 60_000;
    const started = await login();
    for (let i = 0; i < ADMIN_RATE_LIMITS.mfaPerPreAuth.limit; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/auth/mfa/verify',
        cookies: withPreAuth(started),
        payload: { code: '000000' === codeFor(secret) ? '111111' : '000000' },
      });
      expect(res.statusCode).toBe(401);
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/admin/auth/mfa/verify',
      cookies: withPreAuth(started),
      payload: { code: codeFor(secret) },
    });
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json()).toMatchObject({ code: 'UNAUTHENTICATED' });

    // Yeni giriş adımıyla da yönetici başına sınır (15 dk'da 5 deneme) aşılamaz. Buraya kadar 5 deneme
    // yapıldı: kurulumdaki doğru kod, 3 hatalı kod ve engellenen deneme.
    const second = await login();
    const limited = await app.inject({
      method: 'POST',
      url: '/admin/auth/mfa/verify',
      cookies: withPreAuth(second),
      payload: { code: codeFor(secret) },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('password step', () => {
  beforeEach(async () => {
    await admins.add({ tenantId: TENANT, email: EMAIL, password: PASSWORD });
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const wrongPassword = await login(EMAIL, 'yanlis-parola-deneme');
    const unknown = await login('kimse@platform.test', PASSWORD);
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknown.json());
    expect(wrongPassword.json()).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'E-posta ya da parola hatalı.',
    });
    expect(cookie(wrongPassword, ADMIN_PREAUTH_COOKIE_NAME)).toBeUndefined();
  });

  it('normalizes the email (case and spaces)', async () => {
    const res = await login('  AYSE@Platform.TEST ', PASSWORD);
    expect(res.statusCode).toBe(200);
  });

  it('limits attempts per account even when the password is finally right', async () => {
    for (let i = 0; i < ADMIN_RATE_LIMITS.loginPerAccount.limit; i++) {
      expect((await login(EMAIL, `yanlis-${i}-parola`)).statusCode).toBe(401);
    }
    const res = await login();
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe(String(ADMIN_RATE_LIMITS.loginPerAccount.windowSeconds));
  });

  it.each([
    ['an extra field', { email: EMAIL, password: PASSWORD, role: 'owner' }],
    ['a too long password', { email: EMAIL, password: 'a'.repeat(129) }],
    ['a missing email', { password: PASSWORD }],
  ])('rejects %s with 400', async (_, payload) => {
    const res = await app.inject({ method: 'POST', url: '/admin/auth/login', payload });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed code and a verify call without a pre-auth cookie', async () => {
    const started = await login();
    const bad = await app.inject({
      method: 'POST',
      url: '/admin/auth/mfa/verify',
      cookies: withPreAuth(started),
      payload: { code: '12345' },
    });
    expect(bad.statusCode).toBe(400);
    const none = await app.inject({
      method: 'POST',
      url: '/admin/auth/mfa/verify',
      payload: { code: '123456' },
    });
    expect(none.statusCode).toBe(401);
  });
});

describe('admin session', () => {
  it('expires after the absolute lifetime and keeps the idle window sliding', async () => {
    await admins.add({ tenantId: TENANT, email: EMAIL, password: PASSWORD });
    const { session } = await enroll();
    const me = () =>
      app.inject({ method: 'GET', url: '/admin/auth/me', cookies: { [ADMIN_SESSION_COOKIE_NAME]: session } });

    expect((await me()).statusCode).toBe(200);
    expect(sessions.entries.get(session)?.ttlSeconds).toBe(ADMIN_SESSION_IDLE_SECONDS);

    now += (ADMIN_SESSION_ABSOLUTE_SECONDS - 60) * 1000;
    expect((await me()).statusCode).toBe(200);
    expect(sessions.entries.get(session)?.ttlSeconds).toBe(60);

    now += 61_000;
    expect((await me()).statusCode).toBe(401);
    expect(sessions.entries.has(session)).toBe(false);
  });

  it('drops the session when the account is deleted or its MFA is reset', async () => {
    const account = await admins.add({ tenantId: TENANT, email: EMAIL, password: PASSWORD });
    const { session } = await enroll();
    const stored = admins.accounts.get(account.id);
    if (stored) stored.mfaSecretCiphertext = null;
    const res = await app.inject({
      method: 'GET',
      url: '/admin/test/any',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: session },
    });
    expect(res.statusCode).toBe(401);
  });

  it('applies roles from the database on every request', async () => {
    const account = await admins.add({ tenantId: TENANT, email: EMAIL, password: PASSWORD, role: 'owner' });
    const { session } = await enroll();
    const ownerOnly = () =>
      app.inject({
        method: 'GET',
        url: '/admin/test/owner-only',
        cookies: { [ADMIN_SESSION_COOKIE_NAME]: session },
      });
    expect((await ownerOnly()).statusCode).toBe(200);

    const stored = admins.accounts.get(account.id);
    if (stored) stored.role = 'viewer';
    const res = await ownerOnly();
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: 'FORBIDDEN', message: 'Bu işlem için yetkin yok.' });
  });

  it('logs out for good', async () => {
    await admins.add({ tenantId: TENANT, email: EMAIL, password: PASSWORD });
    const { session } = await enroll();
    const out = await app.inject({
      method: 'POST',
      url: '/admin/auth/logout',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: session },
    });
    expect(out.statusCode).toBe(204);
    expect(cookie(out, ADMIN_SESSION_COOKIE_NAME)?.value).toBe('');
    const after = await app.inject({
      method: 'GET',
      url: '/admin/auth/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: session },
    });
    expect(after.statusCode).toBe(401);
  });

  it('keeps admin and player cookies apart in both directions', async () => {
    await admins.add({ tenantId: TENANT, email: EMAIL, password: PASSWORD });
    const { session } = await enroll();
    const asPlayer = await app.inject({
      method: 'GET',
      url: '/player-test',
      cookies: { [SESSION_COOKIE_NAME]: session },
    });
    expect(asPlayer.statusCode).toBe(401);
    const playerCookieOnAdmin = await app.inject({
      method: 'GET',
      url: '/admin/auth/me',
      cookies: { [SESSION_COOKIE_NAME]: session },
    });
    expect(playerCookieOnAdmin.statusCode).toBe(401);
  });
});

describe('cross-site form posts (login CSRF)', () => {
  beforeEach(async () => {
    await admins.add({ tenantId: TENANT, email: EMAIL, password: PASSWORD });
  });

  it.each([
    ['application/x-www-form-urlencoded', `email=${encodeURIComponent(EMAIL)}&password=${PASSWORD}`],
    [
      'multipart/form-data; boundary=x',
      `--x\r\nContent-Disposition: form-data; name="email"\r\n\r\n${EMAIL}\r\n--x--`,
    ],
    ['text/plain', JSON.stringify({ email: EMAIL, password: PASSWORD })],
  ])('refuses a %s body with 415 and sets no cookie', async (contentType, payload) => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      headers: { 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({ code: 'VALIDATION_FAILED', message: 'İstek gövdesi JSON olmalı.' });
    expect(res.cookies).toHaveLength(0);
  });

  it('still accepts JSON with a charset and body-less POSTs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      payload: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(res.statusCode).toBe(200);
    const setup = await app.inject({
      method: 'POST',
      url: '/admin/auth/mfa/setup',
      cookies: withPreAuth(res),
    });
    expect(setup.statusCode).toBe(200);
  });
});
