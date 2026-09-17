import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP: HMAC-SHA1, 30 saniyelik adım, 6 hane. Google Authenticator, Microsoft Authenticator,
 * Bitwarden ve 1Password bu varsayılanları kullanır. Bağımlılık eklememek için burada yazıldı;
 * RFC'deki test vektörleriyle sınanıyor (totp.test.ts).
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Telefon saati kaymasına karşı bir önceki ve bir sonraki adım da kabul edilir (±30 sn). */
export const TOTP_WINDOW = 1;
const SECRET_BYTES = 20;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

export function totpStep(nowSeconds: number): number {
  return Math.floor(nowSeconds / TOTP_STEP_SECONDS);
}

/** `digits` yalnızca RFC test vektörleri (8 hane) için değişir. */
export function totpCodeAt(secret: Buffer, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', secret).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Kodu doğrular ve eşleşen zaman adımını döner. `lastUsedStep` ve öncesindeki adımlar kabul edilmez:
 * ekran görüntüsünden ya da omuz üstünden görülen kod ikinci kez kullanılamaz.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowSeconds: number,
  lastUsedStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(nowSeconds);
  const given = Buffer.from(code);
  let matched: number | null = null;
  // Bütün pencere her seferinde denenir: eşleşmenin hangi adımda olduğu süreden anlaşılmaz.
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    const expected = Buffer.from(totpCodeAt(secret, step));
    if (timingSafeEqual(expected, given) && (lastUsedStep === null || step > lastUsedStep)) {
      matched ??= step;
    }
  }
  return matched;
}

export function otpauthUri(options: { issuer: string; account: string; secret: string }): string {
  const label = encodeURIComponent(`${options.issuer}:${options.account}`);
  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
