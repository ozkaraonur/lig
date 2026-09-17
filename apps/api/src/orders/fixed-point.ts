/**
 * Para ve miktar hesapları için sabit noktalı ondalık sayılar (BigInt).
 *
 * JavaScript `number` ondalıkları tam tutamaz (0.1 + 0.2 = 0.30000000000000004); sanal da olsa bakiyede
 * kuruş kaybolması ya da bedava kuruş oluşması sıralamayı bozar. Değerler veritabanındaki ölçekte tam sayı
 * olarak tutulur: TL kuruş cinsinden (ölçek 2), miktar ve fiyat 10 ondalık (ölçek 10).
 */

export const CASH_SCALE = 2;
export const QUANTITY_SCALE = 10;
export const PRICE_SCALE = 10;

export type Rounding = 'floor' | 'ceil';

/** "123.45" gibi negatif olmayan bir ondalık string'i verilen ölçekte tam sayıya çevirir. Fazla basamak kabul edilmez. */
export function parseFixed(value: string, scale: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new RangeError(`not a non-negative decimal: ${value}`);
  const [, intPart = '0', fraction = ''] = match;
  if (fraction.length > scale) {
    // Veritabanı numeric(…, scale) sondaki sıfırları da döner: "1.5000000000". Anlamlı basamak fazlası hatadır.
    if (/[1-9]/.test(fraction.slice(scale))) {
      throw new RangeError(`too many decimals for scale ${scale}: ${value}`);
    }
  }
  return BigInt(intPart + fraction.slice(0, scale).padEnd(scale, '0'));
}

export function formatFixed(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const intPart = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${intPart}${scale > 0 ? `.${fraction}` : ''}`;
}

/** Tam sayı bölmesi; yuvarlama yönü açıkça seçilir. Yalnızca negatif olmayan değerler için. */
export function divide(numerator: bigint, denominator: bigint, rounding: Rounding): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  if (numerator < 0n) throw new RangeError('numerator must be non-negative');
  const quotient = numerator / denominator;
  return rounding === 'ceil' && quotient * denominator !== numerator ? quotient + 1n : quotient;
}

export const pow10 = (n: number): bigint => 10n ** BigInt(n);
