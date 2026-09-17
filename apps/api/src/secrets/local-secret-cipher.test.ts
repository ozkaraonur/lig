import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { developmentKeyring, generateKeyEntry, LocalSecretCipher, parseKeyring } from './local-secret-cipher';
import { SecretDecryptionError } from './secret-cipher';

const entry = (id: string) => `${id}:${randomBytes(32).toString('base64')}`;

describe('parseKeyring', () => {
  it('uses the first key as active and keeps the rest for decryption', () => {
    const ring = parseKeyring(`${entry('k2')},${entry('k1')}`);
    expect(ring.activeKeyId).toBe('k2');
    expect([...ring.keys.keys()]).toEqual(['k2', 'k1']);
  });

  it.each([
    ['empty', ''],
    ['no id', `:${randomBytes(32).toString('base64')}`],
    ['bad id', `K 1:${randomBytes(32).toString('base64')}`],
    ['short key', `k1:${randomBytes(16).toString('base64')}`],
    ['not base64', 'k1:not-base64-at-all!!'],
    ['repeated id', `${entry('k1')},${entry('k1')}`],
  ])('rejects %s without echoing the key', (_, value) => {
    try {
      parseKeyring(value);
      expect.unreachable();
    } catch (e) {
      const secretPart = value.split(':')[1] ?? '';
      if (secretPart.length > 8) expect((e as Error).message).not.toContain(secretPart);
    }
  });

  it('generates entries that parse', () => {
    expect(parseKeyring(generateKeyEntry('k7')).activeKeyId).toBe('k7');
    expect(() => generateKeyEntry('Bad Id')).toThrow();
  });
});

describe('LocalSecretCipher', () => {
  const cipher = new LocalSecretCipher(parseKeyring(entry('k1')));

  it('round-trips and never repeats a ciphertext', async () => {
    const a = await cipher.encrypt('webhook-secret-ğüş', 'ctx:1');
    const b = await cipher.encrypt('webhook-secret-ğüş', 'ctx:1');
    expect(a).not.toBe(b);
    expect(a).not.toContain('webhook');
    expect(await cipher.decrypt(a, 'ctx:1')).toBe('webhook-secret-ğüş');
  });

  it('binds the ciphertext to its context (copying it to another row fails)', async () => {
    const text = await cipher.encrypt('secret', 'tenants.webhook_secret:A');
    await expect(cipher.decrypt(text, 'tenants.webhook_secret:B')).rejects.toBeInstanceOf(
      SecretDecryptionError,
    );
  });

  it('detects tampering in every part', async () => {
    const text = await cipher.encrypt('secret', 'ctx');
    const parts = text.split('.');
    for (const index of [2, 3, 4]) {
      const changed = [...parts];
      const value = changed[index] ?? '';
      changed[index] = (value[0] === 'A' ? 'B' : 'A') + value.slice(1);
      await expect(cipher.decrypt(changed.join('.'), 'ctx')).rejects.toBeInstanceOf(SecretDecryptionError);
    }
    await expect(cipher.decrypt('plain text', 'ctx')).rejects.toBeInstanceOf(SecretDecryptionError);
    await expect(cipher.decrypt(text.replace('.k1.', '.k9.'), 'ctx')).rejects.toBeInstanceOf(
      SecretDecryptionError,
    );
  });

  it('refuses to decrypt with the wrong key', async () => {
    const other = new LocalSecretCipher(parseKeyring(entry('k1')));
    const text = await cipher.encrypt('secret', 'ctx');
    await expect(other.decrypt(text, 'ctx')).rejects.toBeInstanceOf(SecretDecryptionError);
  });

  it('reads old-key ciphertexts after rotation and reports them as not current', async () => {
    const k1 = entry('k1');
    const before = new LocalSecretCipher(parseKeyring(k1));
    const old = await before.encrypt('secret', 'ctx');
    const after = new LocalSecretCipher(parseKeyring(`${entry('k2')},${k1}`));
    expect(await after.decrypt(old, 'ctx')).toBe('secret');
    expect(after.isCurrent(old)).toBe(false);
    expect(after.isCurrent(await after.encrypt('secret', 'ctx'))).toBe(true);
  });

  it('keeps the development key separate from real keys', async () => {
    const dev = new LocalSecretCipher(developmentKeyring());
    const text = await dev.encrypt('secret', 'ctx');
    expect(text.startsWith('lig1.dev.')).toBe(true);
    await expect(cipher.decrypt(text, 'ctx')).rejects.toBeInstanceOf(SecretDecryptionError);
  });
});
