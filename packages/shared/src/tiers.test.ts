import { describe, expect, it } from 'vitest';
import { computeTierMovements, higherTier, lowerTier, type TierParticipant } from './tiers';

const group = (ranks: number[]): TierParticipant[] => ranks.map((rank, i) => ({ playerId: `p${i}`, rank }));
const moved = (tier: Parameters<typeof computeTierMovements>[0], ranks: number[]) =>
  computeTierMovements(tier, group(ranks)).map((m) => `${m.playerId}:${m.from}>${m.to}`);

describe('kademe sırası', () => {
  it('uçlarda taşmaz', () => {
    expect(higherTier('legend')).toBe('legend');
    expect(lowerTier('bronze')).toBe('bronze');
    expect(higherTier('bronze')).toBe('silver');
    expect(lowerTier('legend')).toBe('platinum');
  });
});

describe('computeTierMovements', () => {
  it('10 oyuncuda üst 2 yükselir, alt 2 düşer', () => {
    const m = moved('silver', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(m).toEqual(['p0:silver>gold', 'p1:silver>gold', 'p9:silver>bronze', 'p8:silver>bronze']);
  });

  it('50 oyuncuda 10 yükselir, 10 düşer', () => {
    const ranks = Array.from({ length: 50 }, (_, i) => i + 1);
    const m = computeTierMovements('gold', group(ranks));
    expect(m.filter((x) => x.to === 'platinum')).toHaveLength(10);
    expect(m.filter((x) => x.to === 'silver')).toHaveLength(10);
  });

  it('5 kişiden az grupta hareket yok', () => {
    expect(moved('gold', [1, 2, 3, 4])).toEqual([]);
  });

  it('5 kişide 1 yükselir, 1 düşer', () => {
    expect(moved('gold', [1, 2, 3, 4, 5])).toEqual(['p0:gold>platinum', 'p4:gold>silver']);
  });

  it('en üst kademede yükselme, en alt kademede düşme yok', () => {
    expect(moved('legend', [1, 2, 3, 4, 5])).toEqual(['p4:legend>platinum']);
    expect(moved('bronze', [1, 2, 3, 4, 5])).toEqual(['p0:bronze>silver']);
  });

  it('sınırdaki eşitlik kotayı aşacaksa o grup dışarıda kalır', () => {
    // 10 kişi, kota 2: sıra 2'yi iki kişi paylaşıyor, biri kotayı aşar, ikisi de yükselmez.
    const m = moved('silver', [1, 2, 2, 4, 5, 6, 7, 8, 9, 10]);
    expect(m.filter((x) => x.endsWith('>gold'))).toEqual(['p0:silver>gold']);
  });

  it('herkes eşitse kimse hareket etmez', () => {
    expect(moved('gold', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toEqual([]);
  });

  it('aynı oyuncu hem yükselip hem düşmez', () => {
    for (let n = 5; n <= 60; n += 1) {
      const m = computeTierMovements('gold', group(Array.from({ length: n }, (_, i) => i + 1)));
      const ids = m.map((x) => x.playerId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
