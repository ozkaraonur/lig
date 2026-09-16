import { describe, expect, it } from 'vitest';
import { moneyAmount, placeOrderRequest, priceTick } from './schemas';

describe('moneyAmount', () => {
  it.each(['1', '5000', '5000.5', '5000.50', '999999999999.99'])('accepts %s', (v) => {
    expect(moneyAmount.safeParse(v).success).toBe(true);
  });

  it.each(['0', '0.00', '-5', '5.123', '1e5', '', ' 5', '5,00', '1234567890123'])('rejects %s', (v) => {
    expect(moneyAmount.safeParse(v).success).toBe(false);
  });
});

describe('placeOrderRequest', () => {
  const valid = {
    assetId: '3f1c2a4e-8b7d-4c6e-9a1b-2d3e4f5a6b7c',
    side: 'buy',
    amount: '5000',
    idempotencyKey: '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d',
  };

  it('accepts a valid order', () => {
    expect(placeOrderRequest.safeParse(valid).success).toBe(true);
  });

  it('rejects an unknown side', () => {
    expect(placeOrderRequest.safeParse({ ...valid, side: 'short' }).success).toBe(false);
  });

  it('requires an idempotency key', () => {
    const { idempotencyKey: _omit, ...rest } = valid;
    expect(placeOrderRequest.safeParse(rest).success).toBe(false);
  });
});

describe('priceTick', () => {
  it('accepts a crypto and an equity symbol', () => {
    expect(priceTick.safeParse({ symbol: 'BTC', price: '5480000', timestamp: Date.now() }).success).toBe(
      true,
    );
    expect(priceTick.safeParse({ symbol: 'THYAO.E', price: '312.50', timestamp: Date.now() }).success).toBe(
      true,
    );
  });

  it('rejects lowercase or injected symbols', () => {
    expect(priceTick.safeParse({ symbol: 'btc', price: '1', timestamp: 1 }).success).toBe(false);
    expect(priceTick.safeParse({ symbol: "BTC';--", price: '1', timestamp: 1 }).success).toBe(false);
  });
});
