import { describe, expect, it } from 'vitest';
import { CASH_SCALE, divide, formatFixed, parseFixed, PRICE_SCALE, QUANTITY_SCALE } from './fixed-point';
import {
  averageCostAfterBuy,
  buyQuantity,
  quantityValue,
  returnPercentUnits,
  sellQuantityForAmount,
} from './order-math';

const cash = (v: string) => parseFixed(v, CASH_SCALE);
const qty = (v: string) => parseFixed(v, QUANTITY_SCALE);
const price = (v: string) => parseFixed(v, PRICE_SCALE);
const fmtCash = (u: bigint) => formatFixed(u, CASH_SCALE);
const fmtQty = (u: bigint) => formatFixed(u, QUANTITY_SCALE);

describe('parseFixed / formatFixed', () => {
  it.each([
    ['0', 2, 0n, '0.00'],
    ['1', 2, 100n, '1.00'],
    ['12.3', 2, 1230n, '12.30'],
    ['0.05', 2, 5n, '0.05'],
    ['4032532.88', 10, 40325328800000000n, '4032532.8800000000'],
  ])('%s at scale %i', (input, scale, units, formatted) => {
    expect(parseFixed(input, scale)).toBe(units);
    expect(formatFixed(units, scale)).toBe(formatted);
  });

  it('accepts trailing zeros beyond the scale as returned by numeric columns', () => {
    expect(parseFixed('100000.0000', 2)).toBe(10_000_000n);
  });

  it.each(['1.001', '-1', '1e3', '', 'abc', ' 1'])('rejects %j at scale 2', (input) => {
    expect(() => parseFixed(input, 2)).toThrow(RangeError);
  });

  it('formats negative values', () => {
    expect(formatFixed(-5n, 2)).toBe('-0.05');
    expect(formatFixed(-12345n, 2)).toBe('-123.45');
  });
});

describe('divide', () => {
  it('rounds in the requested direction', () => {
    expect(divide(10n, 3n, 'floor')).toBe(3n);
    expect(divide(10n, 3n, 'ceil')).toBe(4n);
    expect(divide(9n, 3n, 'ceil')).toBe(3n);
  });

  it('refuses a zero or negative denominator', () => {
    expect(() => divide(1n, 0n, 'floor')).toThrow(RangeError);
  });
});

describe('buyQuantity', () => {
  it('buys the exact quantity when it divides evenly', () => {
    expect(fmtQty(buyQuantity(cash('1000'), price('250')))).toBe('4.0000000000');
  });

  it('rounds the bought quantity down', () => {
    // 100 / 3 = 33.33333333333...
    expect(fmtQty(buyQuantity(cash('100'), price('3')))).toBe('33.3333333333');
  });

  it('returns zero when the amount is too small for the price', () => {
    expect(buyQuantity(cash('0.01'), price('999999999999999999'))).toBe(0n);
  });

  it('handles a large BTC purchase without precision loss', () => {
    expect(fmtQty(buyQuantity(cash('100000.00'), price('4032532.88')))).toBe('0.0247983098');
  });
});

describe('sellQuantityForAmount', () => {
  it('rounds the given-up quantity up', () => {
    expect(fmtQty(sellQuantityForAmount(cash('100'), price('3')))).toBe('33.3333333334');
  });

  it('is never less than the quantity a buy of the same amount would give', () => {
    for (const [a, p] of [
      ['100', '3'],
      ['0.01', '7'],
      ['5000', '4032532.88'],
      ['123.45', '0.00001'],
    ] as const) {
      expect(sellQuantityForAmount(cash(a), price(p))).toBeGreaterThanOrEqual(buyQuantity(cash(a), price(p)));
    }
  });
});

describe('quantityValue', () => {
  it('rounds value down to kuruş', () => {
    // 33.3333333333 × 3 = 99.9999999999 → 99.99
    expect(fmtCash(quantityValue(qty('33.3333333333'), price('3')))).toBe('99.99');
  });

  it('cannot create money by buying and immediately selling at the same price', () => {
    for (const [a, p] of [
      ['100', '3'],
      ['100000', '4032532.88'],
      ['0.07', '0.0003'],
      ['99999.99', '7.1234567891'],
    ] as const) {
      const bought = buyQuantity(cash(a), price(p));
      expect(quantityValue(bought, price(p))).toBeLessThanOrEqual(cash(a));
    }
  });
});

describe('averageCostAfterBuy', () => {
  it('equals the price on the first buy', () => {
    const q = buyQuantity(cash('1000'), price('250'));
    expect(averageCostAfterBuy(0n, 0n, cash('1000'), q)).toBe(price('250'));
  });

  it('weights by quantity across buys at different prices', () => {
    const q1 = buyQuantity(cash('1000'), price('100')); // 10
    const avg1 = averageCostAfterBuy(0n, 0n, cash('1000'), q1);
    const q2 = buyQuantity(cash('1000'), price('200')); // 5
    const avg2 = averageCostAfterBuy(q1, avg1, cash('1000'), q2);
    // 2000 TL / 15 adet = 133.3333333333… → yukarı 133.3333333334
    expect(formatFixed(avg2, PRICE_SCALE)).toBe('133.3333333334');
  });
});

describe('returnPercentUnits', () => {
  it.each([
    ['112340.00', '100000.00', 1234n],
    ['100000.00', '100000.00', 0n],
    ['87650.50', '100000.00', -1234n],
    ['0.00', '100000.00', -10000n],
  ])('%s from %s', (current, start, expected) => {
    expect(returnPercentUnits(cash(current), cash(start))).toBe(expected);
  });
});

describe('round-trip invariant (anti-cheat)', () => {
  /** mulberry32: tekrarlanabilir rastgele sayılar */
  function seeded(seed: number) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('many small buy/sell cycles at a fixed price never grow the balance', () => {
    const random = seeded(2026);
    for (let i = 0; i < 2_000; i++) {
      const priceUnits = BigInt(1 + Math.floor(random() * 1e9)) * 10n ** BigInt(Math.floor(random() * 8));
      let cashUnits = BigInt(1 + Math.floor(random() * 10_000_000));
      const start = cashUnits;
      for (let round = 0; round < 5; round++) {
        const spend = cashUnits / 3n + 1n > cashUnits ? cashUnits : cashUnits / 3n + 1n;
        const bought = buyQuantity(spend, priceUnits);
        cashUnits -= spend;
        cashUnits += quantityValue(bought, priceUnits);
      }
      expect(cashUnits).toBeLessThanOrEqual(start);
    }
  });
});
