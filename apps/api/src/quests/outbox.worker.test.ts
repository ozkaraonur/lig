import { describe, expect, it } from 'vitest';
import { evaluationTimes } from './outbox.worker';

describe('evaluationTimes', () => {
  it('evaluates once per week using the latest event of that week', () => {
    const times = evaluationTimes([
      { created_at: '2026-09-15T10:00:00Z' },
      { created_at: '2026-09-16T10:00:00Z' },
      { created_at: '2026-09-20T20:59:00Z' }, // Pazar 23:59 TR, 38. hafta
      { created_at: '2026-09-20T21:01:00Z' }, // Pazartesi 00:01 TR, 39. hafta
    ]);
    expect(times.map((t) => t.toISOString())).toEqual([
      '2026-09-20T20:59:00.000Z',
      '2026-09-20T21:01:00.000Z',
    ]);
  });
});
