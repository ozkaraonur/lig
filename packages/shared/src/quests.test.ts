import { describe, expect, it } from 'vitest';
import { platformEventWebhook, questTitle, questWindow } from './quests';

describe('questWindow', () => {
  it('uses a single window for one-time quests', () => {
    expect(questWindow('once', new Date())).toEqual({ key: 'once', start: null, end: null });
  });

  it('starts the week on Monday 00:00 Turkey time', () => {
    // 17 Eylül 2026 Perşembe 12:00 TR
    const w = questWindow('weekly', new Date('2026-09-17T09:00:00Z'));
    expect(w.key).toBe('2026-W38');
    expect(w.start?.toISOString()).toBe('2026-09-13T21:00:00.000Z'); // Pzt 00:00 TR
    expect(w.end?.toISOString()).toBe('2026-09-20T21:00:00.000Z');
  });

  it('switches week exactly at Monday 00:00 Turkey time, not UTC', () => {
    expect(questWindow('weekly', new Date('2026-09-20T20:59:59Z')).key).toBe('2026-W38'); // Pzr 23:59 TR
    expect(questWindow('weekly', new Date('2026-09-20T21:00:00Z')).key).toBe('2026-W39'); // Pzt 00:00 TR
  });

  it.each([
    ['2026-01-01T12:00:00Z', '2026-W01'], // Perşembe
    ['2027-01-01T12:00:00Z', '2026-W53'], // Cuma, önceki yılın 53. haftası
    ['2024-12-30T12:00:00Z', '2025-W01'], // Pazartesi, sonraki yılın 1. haftası
  ])('uses ISO week-years around new year: %s → %s', (iso, key) => {
    expect(questWindow('weekly', new Date(iso)).key).toBe(key);
  });
});

describe('questTitle', () => {
  it('writes Turkish titles', () => {
    expect(questTitle('place_orders', 5, 'weekly')).toBe('Bu hafta 5 emir ver');
    expect(questTitle('join_league', 1, 'once')).toBe('Bir lige katıl');
    expect(questTitle('real_trade', 1, 'weekly')).toBe('Bu hafta platformda gerçek bir işlem yap');
    expect(questTitle('join_league', 1, 'weekly')).toBe('Bu hafta bir lige katıl');
    expect(questTitle('buy_distinct_sectors', 3, 'weekly')).toBe('Bu hafta 3 farklı sektörden varlık al');
  });
});

describe('platformEventWebhook', () => {
  const valid = {
    eventId: 'evt_12345678',
    type: 'real_trade',
    playerId: 'oyuncu-1',
    occurredAt: '2026-09-17T09:00:00Z',
  };

  it('accepts a valid event', () => {
    expect(platformEventWebhook.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['unknown field', { tenantId: 'x' }],
    ['injection in player id', { playerId: "1' OR '1'='1" }],
    ['unknown type', { type: 'deposit' }],
    ['non-ISO date', { occurredAt: 'dün' }],
    ['short event id', { eventId: 'x' }],
  ])('rejects %s', (_label, override) => {
    expect(platformEventWebhook.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});
