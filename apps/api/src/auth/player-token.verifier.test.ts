import { PLAYER_TOKEN_AUDIENCE } from '@lig/shared';
import { base64url, SignJWT } from 'jose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../common/app-error';
import {
  createTestPlatform,
  fixedClock,
  InMemoryReplayStore,
  InMemoryTenantDirectory,
  NOW,
  type TestPlatform,
} from './fakes.test-utils';
import { PlayerTokenVerifier } from './player-token.verifier';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

let platformA: TestPlatform;
let platformB: TestPlatform;
let replay: InMemoryReplayStore;
let verifier: PlayerTokenVerifier;

beforeAll(async () => {
  platformA = await createTestPlatform(TENANT_A, 'platform-a');
  platformB = await createTestPlatform(TENANT_B, 'platform-b');
});

beforeEach(() => {
  replay = new InMemoryReplayStore();
  verifier = new PlayerTokenVerifier(
    new InMemoryTenantDirectory([platformA.tenant, platformB.tenant]),
    replay,
    fixedClock,
  );
});

async function expectRejected(token: string): Promise<void> {
  const error = await verifier.verify(token).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe('INVALID_TOKEN');
  expect((error as AppError).status).toBe(401);
}

function unsignedToken(header: object, payload: object, signature = ''): string {
  const enc = (o: object) => base64url.encode(JSON.stringify(o));
  return `${enc(header)}.${enc(payload)}.${signature}`;
}

describe('PlayerTokenVerifier (FR-01, T1)', () => {
  it('accepts a valid token and maps it to the right tenant', async () => {
    const result = await verifier.verify(await platformA.sign({ sub: 'oyuncu-42', name: 'Deniz' }));
    expect(result).toEqual({ tenantId: TENANT_A, externalId: 'oyuncu-42', displayName: 'Deniz' });
  });

  it('gives a default display name when the platform sends none', async () => {
    const result = await verifier.verify(await platformA.sign({ sub: 'user-9876' }));
    expect(result.displayName).toBe('Oyuncu 9876');
  });

  describe('signature and algorithm', () => {
    it('rejects alg "none"', async () => {
      const token = unsignedToken(
        { alg: 'none', typ: 'JWT' },
        {
          iss: 'platform-a',
          aud: PLAYER_TOKEN_AUDIENCE,
          sub: 'x',
          jti: 'a'.repeat(20),
          iat: NOW,
          exp: NOW + 60,
        },
      );
      await expectRejected(token);
    });

    it('rejects HS256 signed with the public key as secret (key confusion)', async () => {
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('platform-a')
        .setAudience(PLAYER_TOKEN_AUDIENCE)
        .setSubject('oyuncu-1')
        .setJti('b'.repeat(20))
        .setIssuedAt(NOW)
        .setExpirationTime(NOW + 60)
        .sign(new TextEncoder().encode(platformA.tenant.publicKeyPem));
      await expectRejected(token);
    });

    it('rejects a token whose payload was edited after signing', async () => {
      const [header, , signature] = (await platformA.sign({ sub: 'oyuncu-1' })).split('.');
      const forgedPayload = base64url.encode(
        JSON.stringify({
          iss: 'platform-a',
          aud: PLAYER_TOKEN_AUDIENCE,
          sub: 'admin',
          jti: 'c'.repeat(20),
          iat: NOW,
          exp: NOW + 60,
        }),
      );
      await expectRejected(`${header}.${forgedPayload}.${signature}`);
    });

    it('rejects garbage', async () => {
      await expectRejected('not-a-jwt-at-all-but-long-enough');
    });
  });

  describe('tenant isolation', () => {
    it("rejects platform B's key claiming to be platform A", async () => {
      const token = await platformB.sign({ iss: 'platform-a' });
      await expectRejected(token);
    });

    it('rejects an unknown issuer', async () => {
      await expectRejected(await platformA.sign({ iss: 'someone-else' }));
    });
  });

  describe('claims', () => {
    it('rejects a token for another audience', async () => {
      await expectRejected(await platformA.sign({ aud: 'another-service' }));
    });

    it('rejects an expired token', async () => {
      await expectRejected(await platformA.sign({ iat: NOW - 400, exp: NOW - 100 }));
    });

    it('accepts a token expired within the clock tolerance', async () => {
      await expect(
        verifier.verify(await platformA.sign({ iat: NOW - 290, exp: NOW - 3 })),
      ).resolves.toBeDefined();
    });

    it('rejects a token issued in the future', async () => {
      await expectRejected(await platformA.sign({ iat: NOW + 60, exp: NOW + 200 }));
    });

    it('rejects a token living longer than 5 minutes', async () => {
      await expectRejected(await platformA.sign({ iat: NOW, exp: NOW + 3600 }));
    });

    it('rejects a token without jti', async () => {
      await expectRejected(await platformA.sign({ jti: null }));
    });

    it('rejects an invalid subject', async () => {
      await expectRejected(await platformA.sign({ sub: '<script>alert(1)</script>' }));
    });

    it('rejects a display name with HTML', async () => {
      await expectRejected(await platformA.sign({ name: '<img src=x onerror=alert(1)>' }));
    });
  });

  describe('replay', () => {
    it('rejects the same token the second time', async () => {
      const token = await platformA.sign();
      await expect(verifier.verify(token)).resolves.toBeDefined();
      await expectRejected(token);
    });

    it('keeps the replay marker until the token can no longer be valid', async () => {
      await verifier.verify(await platformA.sign({ jti: 'd'.repeat(24), iat: NOW, exp: NOW + 300 }));
      expect(replay.used.get(`jti:${TENANT_A}:${'d'.repeat(24)}`)).toBe(305);
    });

    it('scopes jti per tenant', async () => {
      const jti = 'e'.repeat(24);
      await expect(verifier.verify(await platformA.sign({ jti }))).resolves.toBeDefined();
      await expect(verifier.verify(await platformB.sign({ jti }))).resolves.toBeDefined();
    });
  });
});
