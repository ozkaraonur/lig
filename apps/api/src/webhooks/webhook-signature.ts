import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * İmza biçimi (FR-31, T5): `x-lig-signature: v1=<hex>`, hex = HMAC-SHA256(anahtar, "<timestamp>.<ham gövde>").
 * Zaman damgası imzaya dahil olduğu için değiştirilemez; eski bir istek pencere dışında kalınca reddedilir.
 * Gövdenin JSON olarak ayrıştırılmış hali değil ham baytları imzalanır: boşluk ya da alan sırası farkı
 * imzayı bozar, kimse "aynı anlama gelen farklı gövde" üretemez.
 */
export function signWebhook(secret: string, timestamp: string, rawBody: Buffer | string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex')}`;
}

const SIGNATURE_PATTERN = /^v1=[0-9a-f]{64}$/;

/** Sabit sürede karşılaştırır: yanlış imzanın kaçıncı karakterde ayrıldığı yanıt süresinden anlaşılamaz. */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
  signature: string,
): boolean {
  if (!SIGNATURE_PATTERN.test(signature)) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, rawBody));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
