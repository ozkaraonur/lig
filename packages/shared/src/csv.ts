/**
 * CSV dışa aktarım (FR-25, K-035). Dosya panelin dışına çıkar ve e-tabloda açılır: formül enjeksiyonuna
 * karşı metin hücreleri korunur. Oyuncular yalnızca takma kimlikleriyle yer alır (NFR-04).
 */
export const CSV_EXPORT_KINDS = ['league-ranking', 'metrics'] as const;
export type CsvExportKind = (typeof CSV_EXPORT_KINDS)[number];

/** Tek dışa aktarımdaki en fazla veri satırı. Aşan lig kırpılmaz, reddedilir: eksik dosya sessizce yanıltır. */
export const CSV_MAX_ROWS = 50_000;

/** Excel'in UTF-8 olarak tanıması için dosya başı. */
export const CSV_BOM = '﻿';

export type CsvCell = string | number | null;

/** E-tablonun formül saydığı başlangıç karakterleri (OWASP CSV Injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Metin hücresi formül olarak çalışmasın diye başına tek tırnak konur. Sayılar (negatif olsa da) korunmaz:
 * hücre tipi `number` ise biçimi bizden, değil dışarıdan gelir.
 */
export function csvCell(value: CsvCell): string {
  if (value === null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CSV hücresi sonlu bir sayı olmalı');
    return String(value);
  }
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** RFC 4180: virgül ayırıcı, CRLF satır sonu, başta BOM. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}

export const CSV_RANKING_HEADER = [
  'sira',
  'oyuncu_kimligi',
  'toplam_deger',
  'getiri_yuzde',
  'verilen_xp',
] as const;
export const CSV_METRICS_HEADER = ['bolum', 'ad', 'deger'] as const;
