import { describe, expect, it } from 'vitest';
import { formatCashTr, formatDecimalTr } from './format';

describe('formatDecimalTr', () => {
  it.each([
    ['0', '0'],
    ['999', '999'],
    ['1000', '1.000'],
    ['4032532.88', '4.032.532,88'],
    ['110.0269', '110,0269'],
    ['007.5', '7,5'],
    ['-1234.5', '-1.234,5'],
  ])('%s → %s', (input, expected) => {
    expect(formatDecimalTr(input)).toBe(expected);
  });

  it('keeps precision beyond what a JavaScript number can hold', () => {
    expect(formatDecimalTr('123456789012345678.1234567891')).toBe('123.456.789.012.345.678,1234567891');
  });

  it('returns unexpected input unchanged instead of guessing', () => {
    expect(formatDecimalTr('1e5')).toBe('1e5');
  });
});

describe('formatCashTr', () => {
  it.each([
    ['100000', '100.000,00 ₺'],
    ['100000.5', '100.000,50 ₺'],
    ['25000.50', '25.000,50 ₺'],
  ])('%s → %s', (input, expected) => {
    expect(formatCashTr(input)).toBe(expected);
  });
});
