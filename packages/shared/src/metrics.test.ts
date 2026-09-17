import { describe, expect, it } from 'vitest';
import { DEFAULT_METRIC_RANGE, formatRatio, metricsQuery, ratio, realTradeClickRequest } from './metrics';

describe('metricsQuery', () => {
  it('dönem verilmezse 30 gün', () => {
    expect(metricsQuery.parse({}).days).toBe(DEFAULT_METRIC_RANGE);
  });

  it('adres çubuğundan gelen metni sayıya çevirir', () => {
    expect(metricsQuery.parse({ days: '7' }).days).toBe(7);
  });

  it('listede olmayan dönemi ve fazladan alanı reddeder', () => {
    for (const bad of [{ days: 1 }, { days: 365 }, { days: 'abc' }, { days: 7.5 }, { days: 30, x: 1 }]) {
      expect(metricsQuery.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('realTradeClickRequest', () => {
  it('lig kimliği isteğe bağlı, uuid olmalı', () => {
    expect(realTradeClickRequest.safeParse({}).success).toBe(true);
    expect(realTradeClickRequest.safeParse({ leagueId: null }).success).toBe(true);
    expect(realTradeClickRequest.safeParse({ leagueId: crypto.randomUUID() }).success).toBe(true);
    expect(realTradeClickRequest.safeParse({ leagueId: 'x' }).success).toBe(false);
  });

  it('fazladan alan kabul etmez: adres istemciden gelmez', () => {
    expect(realTradeClickRequest.safeParse({ url: 'https://evil.test' }).success).toBe(false);
  });
});

describe('ratio', () => {
  it('payda sıfırsa null', () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, 0)).toBeNull();
  });

  it('oranı 0-1 arası verir', () => {
    expect(ratio(1, 4)).toBe(0.25);
  });

  it('formatRatio yüzde yazar, boşsa tire', () => {
    expect(formatRatio(0.25)).toBe('%25');
    expect(formatRatio(0.3333)).toBe('%33,3');
    expect(formatRatio(null)).toBe('-');
  });
});
