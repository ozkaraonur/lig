import { describe, expect, it } from 'vitest';
import { createSessionRequest, displayName, externalPlayerId, playerTokenClaims } from './auth';

const NUL = String.fromCharCode(0);

describe('externalPlayerId', () => {
  it.each(['oyuncu-1', 'user_42', 'tenant:abc.123'])('accepts %s', (v) => {
    expect(externalPlayerId.safeParse(v).success).toBe(true);
  });

  it.each(['', 'a b', '<script>', 'x'.repeat(129), 'ali@example.com', "1' OR '1'='1"])('rejects %s', (v) => {
    expect(externalPlayerId.safeParse(v).success).toBe(false);
  });
});

describe('displayName', () => {
  it('trims and accepts Turkish characters', () => {
    expect(displayName.parse('  Çağrı Şen  ')).toBe('Çağrı Şen');
  });

  it.each(['', '   ', 'x'.repeat(41), '<img src=x>', `a${NUL}b`, 'line\nbreak'])('rejects %j', (v) => {
    expect(displayName.safeParse(v).success).toBe(false);
  });
});

describe('createSessionRequest', () => {
  it('rejects oversized tokens', () => {
    expect(createSessionRequest.safeParse({ token: 'a'.repeat(4097) }).success).toBe(false);
  });

  it('rejects extra-short tokens', () => {
    expect(createSessionRequest.safeParse({ token: 'short' }).success).toBe(false);
  });
});

describe('playerTokenClaims', () => {
  it('requires jti', () => {
    expect(playerTokenClaims.safeParse({ iss: 'x', sub: 'p1', iat: 1, exp: 2 }).success).toBe(false);
  });
});
