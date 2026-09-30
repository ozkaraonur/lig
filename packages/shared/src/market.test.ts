import { describe, expect, it } from 'vitest';
import {
  clampToLimits,
  isTradingDay,
  limitStateAtClose,
  lastSessionClose,
  marketStatus,
  priceLimits,
  sessionsOn,
  trDate,
} from './market';

/** Türkiye saatiyle verilen anın UTC karşılığı (TR sabit UTC+3). */
const tr = (iso: string) => new Date(`${iso}+03:00`);

describe('seans takvimi', () => {
  it('hafta içi tam günde iki seans vardır, öğle arası kapalıdır', () => {
    // 22 Eylül 2026 salı, tatil değil.
    expect(marketStatus(tr('2026-09-22T09:59:00')).phase).toBe('before_open');
    expect(marketStatus(tr('2026-09-22T10:00:00')).open).toBe(true);
    expect(marketStatus(tr('2026-09-22T12:59:59')).open).toBe(true);
    expect(marketStatus(tr('2026-09-22T13:00:00')).phase).toBe('lunch_break');
    expect(marketStatus(tr('2026-09-22T13:59:59')).open).toBe(false);
    expect(marketStatus(tr('2026-09-22T14:00:00')).open).toBe(true);
    expect(marketStatus(tr('2026-09-22T17:59:59')).open).toBe(true);
    expect(marketStatus(tr('2026-09-22T18:00:00')).phase).toBe('after_close');
  });

  it('açıkken o seansın kapanışını, kapalıyken bir sonraki açılışı verir', () => {
    const open = marketStatus(tr('2026-09-22T11:00:00'));
    expect(open.closesAt).toBe(tr('2026-09-22T13:00:00').toISOString());
    expect(open.opensAt).toBeNull();

    const lunch = marketStatus(tr('2026-09-22T13:30:00'));
    expect(lunch.opensAt).toBe(tr('2026-09-22T14:00:00').toISOString());
    expect(lunch.closesAt).toBeNull();

    const evening = marketStatus(tr('2026-09-22T20:00:00'));
    expect(evening.opensAt).toBe(tr('2026-09-23T10:00:00').toISOString());
  });

  it('hafta sonunu atlar', () => {
    const saturday = marketStatus(tr('2026-09-26T11:00:00'));
    expect(saturday).toMatchObject({ open: false, phase: 'weekend' });
    expect(saturday.opensAt).toBe(tr('2026-09-28T10:00:00').toISOString());
  });

  it('resmî tatilde kapalıdır', () => {
    // 29 Ekim 2026 perşembe, Cumhuriyet Bayramı.
    const holiday = marketStatus(tr('2026-10-29T11:00:00'));
    expect(holiday).toMatchObject({ open: false, phase: 'holiday' });
    expect(holiday.opensAt).toBe(tr('2026-10-30T10:00:00').toISOString());
    expect(isTradingDay('2026-10-29')).toBe(false);
  });

  it('bayram arifesinde yalnızca sabah seansı yapılır', () => {
    // 28 Ekim 2026 çarşamba, yarım gün.
    expect(sessionsOn('2026-10-28')).toHaveLength(1);
    expect(marketStatus(tr('2026-10-28T11:00:00')).open).toBe(true);
    const afternoon = marketStatus(tr('2026-10-28T15:00:00'));
    expect(afternoon.open).toBe(false);
    expect(afternoon.phase).toBe('after_close');
    // Ertesi gün tatil olduğu için sıradaki açılış 30 Ekim.
    expect(afternoon.opensAt).toBe(tr('2026-10-30T10:00:00').toISOString());
  });

  it('takvimin kapsamadığı yılda yalnızca hafta sonu kuralı uygulanır ve bunu bildirir', () => {
    const unknown = marketStatus(tr('2030-01-01T11:00:00'));
    expect(unknown.calendarKnown).toBe(false);
    expect(unknown.open).toBe(true);
    expect(marketStatus(tr('2026-09-22T11:00:00')).calendarKnown).toBe(true);
  });

  it('Türkiye takvim gününü UTC kaymasına rağmen doğru verir', () => {
    expect(trDate(new Date('2026-09-22T21:30:00Z'))).toBe('2026-09-23');
    expect(trDate(new Date('2026-09-22T20:59:00Z'))).toBe('2026-09-22');
  });
});

describe('lastSessionClose', () => {
  it('aynı gün kapanmışsa o günü verir', () => {
    const result = lastSessionClose(tr('2026-09-22T19:00:00'));
    expect(result?.date).toBe('2026-09-22');
    expect(result?.closedAt.toISOString()).toBe(tr('2026-09-22T18:00:00').toISOString());
  });

  it('seans sürerken bir önceki seans gününü verir', () => {
    expect(lastSessionClose(tr('2026-09-22T11:00:00'))?.date).toBe('2026-09-21');
  });

  it('hafta sonunda cumayı, tatil sonrası son seans gününü verir', () => {
    expect(lastSessionClose(tr('2026-09-27T11:00:00'))?.date).toBe('2026-09-25');
    expect(lastSessionClose(tr('2026-10-29T11:00:00'))?.date).toBe('2026-10-28');
  });

  it('yarım günde kapanış saati 13:00', () => {
    const half = lastSessionClose(tr('2026-10-28T19:00:00'));
    expect(half?.closedAt.toISOString()).toBe(tr('2026-10-28T13:00:00').toISOString());
  });
});

describe('tavan ve taban', () => {
  it('önceki kapanışa göre ±%10', () => {
    expect(priceLimits('100')).toEqual({ floor: '90.0000', ceiling: '110.0000' });
  });

  it('geçersiz referansta limit yok', () => {
    expect(priceLimits('0')).toBeNull();
    expect(priceLimits('abc')).toBeNull();
  });

  it('aralıktaki fiyata dokunmaz, string aynen döner', () => {
    expect(clampToLimits('105.1234567890', '100')).toEqual({
      price: '105.1234567890',
      clamped: null,
    });
  });

  it('tavanı aşan fiyatı tavana, tabanın altını tabana çeker', () => {
    expect(clampToLimits('130', '100')).toEqual({ price: '110.0000', clamped: 'ceiling' });
    expect(clampToLimits('50', '100')).toEqual({ price: '90.0000', clamped: 'floor' });
  });

  it('referans yoksa (yeni varlık) limit uygulanmaz', () => {
    expect(clampToLimits('999', null)).toEqual({ price: '999', clamped: null });
  });

  it('sınır değerleri aralıkta sayılır', () => {
    expect(clampToLimits('110.0000', '100').clamped).toBeNull();
    expect(clampToLimits('90.0000', '100').clamped).toBeNull();
  });
});

describe('limitStateAtClose', () => {
  it('akışın sınıra çektiği kapanış tavan ya da taban sayılır', () => {
    const up = clampToLimits('150', '100').price;
    const down = clampToLimits('50', '100').price;
    expect(limitStateAtClose(up, '100')).toBe('limit_up');
    expect(limitStateAtClose(down, '100')).toBe('limit_down');
  });

  it('sınıra ondalıkla yaklaşan ama ulaşmayan kapanış tavan sayılmaz', () => {
    expect(limitStateAtClose('109.9999', '100')).toBeNull();
    expect(limitStateAtClose('90.0001', '100')).toBeNull();
    expect(limitStateAtClose('100', '100')).toBeNull();
  });

  it('kolon hassasiyetiyle yazılmış sınır fiyatı da tavan sayılır', () => {
    expect(limitStateAtClose('110.0000000000', '100.0000000000')).toBe('limit_up');
  });

  it('önceki kapanış yoksa ya da bozuksa tavan yoktur', () => {
    expect(limitStateAtClose('150', null)).toBeNull();
    expect(limitStateAtClose('150', '0')).toBeNull();
    expect(limitStateAtClose('abc', '100')).toBeNull();
  });
});
