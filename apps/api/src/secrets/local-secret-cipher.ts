import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { type SecretCipher, SecretDecryptionError } from './secret-cipher';

const FORMAT = 'lig1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

export interface Keyring {
  /** Yeni şifrelemede kullanılan anahtar. */
  activeKeyId: string;
  /** Etkin anahtar ve çözme için tutulan eski anahtarlar. */
  keys: ReadonlyMap<string, Buffer>;
}

/**
 * `SECRET_KEYS` değerini okur: `k2:<base64>,k1:<base64>`. İlk anahtar etkindir, diğerleri yalnızca eski
 * kayıtları çözmek için tutulur. Hata mesajı anahtar değerini içermez.
 */
export function parseKeyring(value: string): Keyring {
  const keys = new Map<string, Buffer>();
  let activeKeyId: string | undefined;
  for (const [index, entry] of value.split(',').entries()) {
    const separator = entry.indexOf(':');
    const id = entry.slice(0, separator).trim();
    const encoded = entry.slice(separator + 1).trim();
    if (separator < 1 || !KEY_ID_PATTERN.test(id)) {
      throw new Error(`SECRET_KEYS: entry ${index + 1} must look like "<id>:<base64 key>"`);
    }
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== KEY_BYTES || key.toString('base64') !== encoded) {
      throw new Error(`SECRET_KEYS: key "${id}" must be ${KEY_BYTES} bytes, base64 encoded`);
    }
    if (keys.has(id)) throw new Error(`SECRET_KEYS: key id "${id}" is repeated`);
    keys.set(id, key);
    activeKeyId ??= id;
  }
  if (!activeKeyId) throw new Error('SECRET_KEYS: at least one key is required');
  return { activeKeyId, keys };
}

/**
 * Yalnızca geliştirme ve test için. Değeri herkesin bildiği bir metinden türetilir, gizli değildir;
 * üretimde `SECRET_KEYS` zorunludur (config/env.ts).
 */
export function developmentKeyring(): Keyring {
  const key = createHash('sha256').update('lig development secret key, not for production').digest();
  return { activeKeyId: 'dev', keys: new Map([['dev', key]]) };
}

export function generateKeyEntry(id: string): string {
  if (!KEY_ID_PATTERN.test(id)) throw new Error('Key id may contain a-z, 0-9 and "-" (max 32)');
  return `${id}:${randomBytes(KEY_BYTES).toString('base64')}`;
}

function aad(keyId: string, context: string): Buffer {
  return Buffer.from(`${FORMAT}|${keyId}|${context}`, 'utf8');
}

/**
 * AES-256-GCM. Çıktı: `lig1.<anahtar kimliği>.<iv>.<etiket>.<şifreli metin>` (base64url).
 * Anahtar kimliği metnin içinde olduğu için eski anahtarla yazılmış kayıtlar anahtar değişiminden sonra da okunur.
 */
export class LocalSecretCipher implements SecretCipher {
  constructor(private readonly keyring: Keyring) {}

  async encrypt(plaintext: string, context: string): Promise<string> {
    const keyId = this.keyring.activeKeyId;
    const key = this.keyring.keys.get(keyId);
    if (!key) throw new Error('Active secret key is missing');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad(keyId, context));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      FORMAT,
      keyId,
      iv.toString('base64url'),
      tag.toString('base64url'),
      body.toString('base64url'),
    ].join('.');
  }

  async decrypt(ciphertext: string, context: string): Promise<string> {
    const parts = ciphertext.split('.');
    if (parts.length !== 5 || parts[0] !== FORMAT) throw new SecretDecryptionError();
    const [, keyId, ivText, tagText, bodyText] = parts as [string, string, string, string, string];
    const key = this.keyring.keys.get(keyId);
    const iv = Buffer.from(ivText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    if (!key || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SecretDecryptionError();
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(aad(keyId, context));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      throw new SecretDecryptionError();
    }
  }

  isCurrent(ciphertext: string): boolean {
    return ciphertext.startsWith(`${FORMAT}.${this.keyring.activeKeyId}.`);
  }
}
