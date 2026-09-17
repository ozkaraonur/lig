import { generateKeyPairSync } from 'node:crypto';
import { PLAYER_TOKEN_AUDIENCE, priceFeedResponse, priceTick } from '@lig/shared';
import type { FastifyInstance } from 'fastify';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type SigningKeys } from './keys.js';
import { buildServer } from './server.js';

let keys: SigningKeys;
let app: FastifyInstance;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  keys = { privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey };
});

beforeEach(async () => {
  app = await buildServer({ keys, issuer: 'mock-test', webUrl: 'http://localhost:3000' });
});

afterEach(async () => {
  await app.close();
});

describe('mock platform', () => {
  it('responds to health checks', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'up', service: 'mock-platform' });
  });

  it('publishes only the public key', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/lig-public-key' });
    expect(res.json()).toEqual({ issuer: 'mock-test', algorithm: 'RS256', publicKeyPem: keys.publicKeyPem });
    expect(res.body).not.toContain('PRIVATE KEY');
  });

  it('issues a short-lived RS256 player token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/players/oyuncu-7/token',
      payload: { displayName: 'Can' },
    });
    expect(res.statusCode).toBe(200);
    const { token, expiresIn } = res.json() as { token: string; expiresIn: number };
    expect(expiresIn).toBe(300);
    expect(decodeProtectedHeader(token).alg).toBe('RS256');

    const { payload } = await jwtVerify(token, await importSPKI(keys.publicKeyPem, 'RS256'), {
      issuer: 'mock-test',
      audience: PLAYER_TOKEN_AUDIENCE,
    });
    expect(payload.sub).toBe('oyuncu-7');
    expect(payload.name).toBe('Can');
    expect(payload.exp! - payload.iat!).toBe(300);
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives every token a unique jti', async () => {
    const issue = async () =>
      (await app.inject({ method: 'POST', url: '/players/oyuncu-1/token', payload: {} })).json() as {
        token: string;
      };
    const [a, b] = await Promise.all([issue(), issue()]);
    const jti = (t: string) => JSON.parse(Buffer.from(t.split('.')[1]!, 'base64url').toString()).jti;
    expect(jti(a.token)).not.toBe(jti(b.token));
  });

  it.each(['bad%20id', '%3Cscript%3E'])('rejects invalid player id %s', async (id) => {
    const res = await app.inject({ method: 'POST', url: `/players/${id}/token`, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unknown body fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/players/oyuncu-1/token',
      payload: { admin: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('serves the login page with a strict CSP', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.body).toContain('http%3A%2F%2Flocalhost%3A3000');
  });

  it('publishes schema-valid prices without caching', async () => {
    const res = await app.inject({ method: 'GET', url: '/prices' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { ticks } = priceFeedResponse.parse(res.json());
    expect(ticks.map((t) => priceTick.parse(t).symbol)).toContain('BTC');
  });

  it('freezes prices while paused and resumes', async () => {
    const snapshot = async () => (await app.inject({ method: 'GET', url: '/prices' })).json();
    await app.inject({ method: 'POST', url: '/debug/prices/pause' });
    expect((await app.inject({ method: 'GET', url: '/debug/prices' })).json()).toEqual({ paused: true });
    await app.inject({ method: 'POST', url: '/debug/prices/resume' });
    expect((await app.inject({ method: 'GET', url: '/debug/prices' })).json()).toEqual({ paused: false });
    expect(await snapshot()).toHaveProperty('ticks');
  });

  it('serves the trade page with a strict CSP', async () => {
    const res = await app.inject({ method: 'GET', url: '/trade' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.body).toContain('/trade.js');
  });

  it('reports that webhooks are not configured and validates the player id', async () => {
    expect((await app.inject({ method: 'POST', url: '/players/oyuncu-1/real-trades' })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/players/%3Cx%3E/real-trades' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/debug/webhooks/replay-last' })).statusCode).toBe(404);
  });
});
