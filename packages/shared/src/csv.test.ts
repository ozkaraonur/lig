import { describe, expect, it } from 'vitest';
import { CSV_BOM, CSV_MAX_ROWS, csvCell, toCsv } from './csv';

describe('csvCell', () => {
  it.each(['=1+1', '+90', '-2+3', '@SUM(A1)', '\t=x', '\r=x'])('formül başlangıcı korunur: %j', (v) => {
    expect(csvCell(v).replace(/^"/, '')).toMatch(/^'/);
  });

  it('negatif sayı hücresi korunmaz, metin olsaydı korunurdu', () => {
    expect(csvCell(-3.5)).toBe('-3.5');
    expect(csvCell('-3.5')).toBe("'-3.5");
  });

  it('virgül, tırnak ve satır sonu tırnaklanır', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('formül ve tırnak birlikte: önce korunur, sonra tırnaklanır', () => {
    expect(csvCell('=A,"x"')).toBe('"\'=A,""x"""');
  });

  it('null boş, sonsuz sayı hata', () => {
    expect(csvCell(null)).toBe('');
    expect(() => csvCell(Number.NaN)).toThrow();
    expect(() => csvCell(Infinity)).toThrow();
  });
});

describe('toCsv', () => {
  it('BOM, başlık ve CRLF', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          [1, 'x'],
          [null, '=y'],
        ],
      ),
    ).toBe(`${CSV_BOM}a,b\r\n1,x\r\n,'=y\r\n`);
  });
});

describe('CSV_MAX_ROWS', () => {
  it('varsayılan sınır 50.000 satır', () => {
    expect(CSV_MAX_ROWS).toBe(50_000);
  });
});
