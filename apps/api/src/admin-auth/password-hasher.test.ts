import { describe, expect, it } from 'vitest';
import { ARGON2_PARAMS, burnPasswordCheck, hashPassword, verifyPassword } from './password-hasher';

describe('argon2id password hashing', () => {
  it('stores a salted PHC string and verifies only the right password', async () => {
    const a = await hashPassword('doğru-parola-123');
    const b = await hashPassword('doğru-parola-123');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'doğru-parola-123')).toEqual({ valid: true, needsRehash: false });
    expect((await verifyPassword(a, 'dogru-parola-123')).valid).toBe(false);
    expect((await verifyPassword(a, '')).valid).toBe(false);
  });

  it('matches a known vector from the reference implementation', async () => {
    // Referans libargon2 (Python argon2-cffi): hash_secret(b"password", b"somesaltsomesalt", time_cost=2,
    // memory_cost=1024, parallelism=1, hash_len=32, type=ID)
    const known =
      '$argon2id$v=19$m=1024,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$CKGe5/bX9YnCq2rxjW5yQXKxn31v1GKzhDCrMc6r6vA';
    const check = await verifyPassword(known, 'password');
    expect(check.valid).toBe(true);
    expect(check.needsRehash).toBe(true);
  });

  it('treats unicode-equivalent spellings as the same password (NFKC)', async () => {
    const hash = await hashPassword('ﬁrma-parolası-12');
    expect((await verifyPassword(hash, 'firma-parolası-12')).valid).toBe(true);
  });

  it.each([
    ['garbage', 'not-a-hash'],
    [
      'another algorithm',
      '$argon2i$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$zwiFIBfXhPMiI7/Z/KHn8R6IiZRWNsOyhIo6pOt4dHs',
    ],
    [
      'absurd memory',
      '$argon2id$v=19$m=99999999,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$zwiFIBfXhPMiI7/Z/KHn8R6IiZRWNsOyhIo6pOt4dHs',
    ],
    [
      'absurd passes',
      '$argon2id$v=19$m=19456,t=999,p=1$c29tZXNhbHRzb21lc2FsdA$zwiFIBfXhPMiI7/Z/KHn8R6IiZRWNsOyhIo6pOt4dHs',
    ],
  ])('rejects a stored hash with %s without doing expensive work', async (_, stored) => {
    expect(await verifyPassword(stored, 'password')).toEqual({ valid: false, needsRehash: false });
  });

  it('runs a comparable check when the account does not exist', async () => {
    await expect(burnPasswordCheck('anything')).resolves.toBeUndefined();
    expect(ARGON2_PARAMS.memoryKiB).toBeGreaterThanOrEqual(19_456);
  });
});
