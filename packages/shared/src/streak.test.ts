import { describe, expect, it } from 'vitest';
import { computeStreak, daysToNextMilestone } from './streak';

describe('computeStreak', () => {
  it('hiç etkin gün yoksa seri yok', () => {
    expect(computeStreak([], '2026-09-30').days).toBe(0);
  });

  it('art arda günler sayılır', () => {
    const s = computeStreak(['2026-09-28', '2026-09-29', '2026-09-30'], '2026-09-30');
    expect(s).toMatchObject({ days: 3, startDate: '2026-09-28', activeToday: true, atRisk: false });
  });

  it('bir gün kaçırmak seriyi bozmaz', () => {
    const s = computeStreak(['2026-09-26', '2026-09-28', '2026-09-30'], '2026-09-30');
    expect(s.days).toBe(3);
    expect(s.startDate).toBe('2026-09-26');
  });

  it('iki gün kaçırmak seriyi koparır, yeni seri sonrasından başlar', () => {
    const s = computeStreak(['2026-09-20', '2026-09-21', '2026-09-25', '2026-09-26'], '2026-09-26');
    expect(s.days).toBe(2);
    expect(s.startDate).toBe('2026-09-25');
  });

  it('bugün etkin değil ama dün etkin: seri sürüyor, riskte değil', () => {
    const s = computeStreak(['2026-09-29'], '2026-09-30');
    expect(s).toMatchObject({ days: 1, activeToday: false, atRisk: false });
  });

  it('son etkin gün 2 gün önceyse seri yaşıyor ama riskte', () => {
    const s = computeStreak(['2026-09-28'], '2026-09-30');
    expect(s).toMatchObject({ days: 1, activeToday: false, atRisk: true });
  });

  it('son etkin gün 3 gün önceyse seri kopmuş', () => {
    expect(computeStreak(['2026-09-27'], '2026-09-30').days).toBe(0);
  });

  it('ay ve yıl sınırını geçer', () => {
    const s = computeStreak(['2026-12-30', '2027-01-01'], '2027-01-01');
    expect(s.days).toBe(2);
  });

  it('gelecek tarihli gün ve tekrarlar yok sayılır', () => {
    const s = computeStreak(['2026-09-30', '2026-09-30', '2026-10-05'], '2026-09-30');
    expect(s.days).toBe(1);
  });

  it('7 etkin günde ilk eşik tamamlanır', () => {
    const days = ['01', '02', '03', '04', '05', '06', '07'].map((d) => `2026-09-${d}`);
    expect(computeStreak(days, '2026-09-07').milestones).toBe(1);
    expect(computeStreak(days.slice(1), '2026-09-07').milestones).toBe(0);
  });

  it('sonraki eşiğe kalan gün', () => {
    expect(daysToNextMilestone(0)).toBe(7);
    expect(daysToNextMilestone(6)).toBe(1);
    expect(daysToNextMilestone(7)).toBe(7);
  });
});
