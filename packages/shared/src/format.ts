/**
 * Ekranda gösterim için Türkçe sayı biçimi. Tutarlar string gelir ve number'a çevrilmeden biçimlenir:
 * büyük tutarlarda kuruş kaybı olmaz.
 */
export function formatDecimalTr(value: string, minFractionDigits = 0): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign, intPart = '0', fraction = ''] = match;
  const grouped = intPart.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const paddedFraction = fraction.padEnd(minFractionDigits, '0');
  return `${sign}${grouped}${paddedFraction ? `,${paddedFraction}` : ''}`;
}

/** Sanal TL: her zaman iki ondalık. "100000" → "100.000,00 ₺" */
export function formatCashTr(value: string): string {
  const [intPart, fraction = ''] = value.split('.');
  return `${formatDecimalTr(`${intPart}.${fraction.padEnd(2, '0').slice(0, 2)}`)} ₺`;
}
