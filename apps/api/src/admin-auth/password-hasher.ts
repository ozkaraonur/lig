import * as crypto from 'node:crypto';

/**
 * argon2id parametreleri. OWASP Password Storage Cheat Sheet'in önerdiği asgari değerler:
 * 19 MiB bellek, 2 tur, 1 iş parçacığı. Tek doğrulama bu makinede yaklaşık 50-100 ms sürer.
 */
export const ARGON2_PARAMS = { memoryKiB: 19_456, passes: 2, parallelism: 1, saltBytes: 16, tagBytes: 32 };

const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d{1,8}),t=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]{16,})\$([A-Za-z0-9+/]{32,})$/;

interface Argon2Options {
  message: string | Buffer;
  nonce: Buffer;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
}

type Argon2Fn = (
  algorithm: 'argon2id',
  options: Argon2Options,
  callback: (err: Error | null, key: Buffer) => void,
) => void;

/** Node 24.7'den önce `crypto.argon2` yok. Eski sürümde anlaşılır bir hatayla durulur. */
function nodeArgon2(): Argon2Fn {
  const fn = (crypto as unknown as { argon2?: Argon2Fn }).argon2;
  if (typeof fn !== 'function') {
    throw new Error(`Node ${process.versions.node} has no crypto.argon2; Node 24.7 or newer is required`);
  }
  return fn;
}

function derive(password: string, salt: Buffer, m: number, t: number, p: number, tagBytes: number) {
  const argon2 = nodeArgon2();
  return new Promise<Buffer>((resolve, reject) => {
    argon2(
      'argon2id',
      // NFKC: aynı görünen parola farklı klavyelerde farklı bayt dizisiyle yazılsa da eşleşir (NIST 800-63B).
      {
        message: password.normalize('NFKC'),
        nonce: salt,
        parallelism: p,
        tagLength: tagBytes,
        memory: m,
        passes: t,
      },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');

/** PHC biçiminde hash: `$argon2id$v=19$m=19456,t=2,p=1$<tuz>$<özet>` (argon2 kütüphaneleriyle uyumlu). */
export async function hashPassword(password: string): Promise<string> {
  const { memoryKiB, passes, parallelism, saltBytes, tagBytes } = ARGON2_PARAMS;
  const salt = crypto.randomBytes(saltBytes);
  const tag = await derive(password, salt, memoryKiB, passes, parallelism, tagBytes);
  return `$argon2id$v=19$m=${memoryKiB},t=${passes},p=${parallelism}$${b64(salt)}$${b64(tag)}`;
}

export interface PasswordCheck {
  valid: boolean;
  /** Parametreler güncel değil: doğru girişte hash yeni parametrelerle yeniden yazılmalı. */
  needsRehash: boolean;
}

export async function verifyPassword(storedHash: string, password: string): Promise<PasswordCheck> {
  const match = PHC_PATTERN.exec(storedHash);
  if (!match) return { valid: false, needsRehash: false };
  const [, m, t, p, saltText, tagText] = match as unknown as [string, string, string, string, string, string];
  const memory = Number(m);
  const passes = Number(t);
  const parallelism = Number(p);
  // Bozuk ya da kötü niyetle yazılmış bir kayıt sunucuyu dev bellek istemeye zorlayamasın.
  if (memory < 8 || memory > 262_144 || passes < 1 || passes > 16 || parallelism < 1 || parallelism > 8) {
    return { valid: false, needsRehash: false };
  }
  const salt = Buffer.from(saltText, 'base64');
  const expected = Buffer.from(tagText, 'base64');
  const actual = await derive(password, salt, memory, passes, parallelism, expected.length);
  const valid = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  const { memoryKiB, passes: currentPasses, parallelism: currentP } = ARGON2_PARAMS;
  return {
    valid,
    needsRehash: valid && (memory !== memoryKiB || passes !== currentPasses || parallelism !== currentP),
  };
}

let dummyHash: Promise<string> | undefined;

/**
 * Böyle bir yönetici yoksa da aynı sürede cevap vermek için boşa bir doğrulama yapılır. Aksi halde yanıt
 * süresinden hangi e-postanın kayıtlı olduğu anlaşılırdı (hesap keşfi).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('lig-dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
}
