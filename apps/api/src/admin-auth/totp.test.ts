import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpCodeAt,
  totpStep,
  verifyTotp,
} from './totp';

describe('RFC 6238 test vectors (SHA-1, 8 digits)', () => {
  const secret = Buffer.from('12345678901234567890', 'ascii');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('time %i → %s', (time, code) => {
    expect(totpCodeAt(secret, totpStep(time), 8)).toBe(code);
  });
});

describe('base32', () => {
  it('matches RFC 4648 examples and round-trips', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb-oi').toString()).toBe('foobar');
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(() => base32Decode('01')).toThrow();
  });
});

describe('verifyTotp', () => {
  const secret = generateTotpSecret();
  const now = 1_789_640_000;
  const codeAt = (offsetSteps: number) => totpCodeAt(base32Decode(secret), totpStep(now) + offsetSteps);

  it('accepts the current code and one step of clock drift either way', () => {
    expect(verifyTotp(secret, codeAt(0), now, null)).toBe(totpStep(now));
    expect(verifyTotp(secret, codeAt(-1), now, null)).toBe(totpStep(now) - 1);
    expect(verifyTotp(secret, codeAt(1), now, null)).toBe(totpStep(now) + 1);
  });

  it('rejects codes outside the window', () => {
    expect(verifyTotp(secret, codeAt(-2), now, null)).toBeNull();
    expect(verifyTotp(secret, codeAt(2), now, null)).toBeNull();
  });

  it('never accepts the same or an older step twice (replay)', () => {
    const step = verifyTotp(secret, codeAt(0), now, null);
    expect(verifyTotp(secret, codeAt(0), now, step)).toBeNull();
    expect(verifyTotp(secret, codeAt(-1), now, step)).toBeNull();
    expect(verifyTotp(secret, codeAt(1), now, step)).toBe(totpStep(now) + 1);
  });

  it.each(['', '12345', '1234567', 'abcdef', '12 456', '１２３４５６'])(
    'rejects malformed code %j',
    (code) => {
      expect(verifyTotp(secret, code, now, null)).toBeNull();
    },
  );

  it('rejects a code made with another secret', () => {
    const other = generateTotpSecret();
    expect(verifyTotp(other, codeAt(0), now, null)).toBeNull();
  });
});

describe('otpauthUri', () => {
  it('builds the URI authenticator apps expect', () => {
    const uri = otpauthUri({ issuer: 'Lig', account: 'ayse@platform.test', secret: 'JBSWY3DPEHPK3PXP' });
    expect(uri).toBe(
      'otpauth://totp/Lig%3Aayse%40platform.test?secret=JBSWY3DPEHPK3PXP&issuer=Lig&algorithm=SHA1&digits=6&period=30',
    );
  });
});
