import { describe, expect, it } from 'vitest';
import { computeRewards, computeStandings, LEAGUE_REWARDS, type MemberHolding } from './standings';

let seq = 0;
function member(cash: string, positions: MemberHolding['positions'] = [], joinedAt = seq++): MemberHolding {
  return {
    membershipId: `m${String(joinedAt).padStart(3, '0')}`,
    playerId: `p${joinedAt}`,
    cash,
    joinedAt: new Date(joinedAt * 1000),
    positions,
  };
}

const btc = (quantity: string, avgCost = '100') => ({ assetId: 'btc', symbol: 'BTC', quantity, avgCost });

describe('computeStandings (FR-06)', () => {
  it('ranks by cash plus position value at the latest price', () => {
    const a = member('1000.00');
    const b = member('500.00', [btc('10')]); // 10 × 60 = 600 → 1100
    const c = member('0.00', [btc('5')]); // 5 × 60 = 300
    const result = computeStandings([a, b, c], new Map([['btc', '60']]));
    expect(result.map((s) => [s.playerId, s.valueUnits, s.rank])).toEqual([
      [b.playerId, 110000n, 1],
      [a.playerId, 100000n, 2],
      [c.playerId, 30000n, 3],
    ]);
  });

  it('shares a rank on equal value and skips the next (1, 2, 2, 4)', () => {
    const members = [member('900.00'), member('800.00'), member('800.00'), member('100.00')];
    expect(computeStandings(members, new Map()).map((s) => s.rank)).toEqual([1, 2, 2, 4]);
  });

  it('orders ties deterministically by join time', () => {
    const later = member('800.00', [], 50);
    const earlier = member('800.00', [], 10);
    expect(computeStandings([later, earlier], new Map()).map((s) => s.playerId)).toEqual([
      earlier.playerId,
      later.playerId,
    ]);
  });

  it('values a position without any price at its average cost', () => {
    const m = member('0.00', [btc('2', '150')]);
    expect(computeStandings([m], new Map([['btc', null]]))[0]?.valueUnits).toBe(30000n);
  });

  it('returns an empty list for a league without members', () => {
    expect(computeStandings([], new Map())).toEqual([]);
  });
});

describe('computeRewards (FR-32)', () => {
  const standingsOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      membershipId: `m${i}`,
      playerId: `p${i}`,
      valueUnits: BigInt(1000 - i),
      rank: i + 1,
    }));
  const everyone = (n: number) => new Set(Array.from({ length: n }, (_, i) => `m${i}`));

  it('gives podium, top 10% and participation XP', () => {
    const grants = computeRewards('L', standingsOf(40), everyone(40));
    const byPlayer = new Map(grants.map((g) => [g.playerId, g]));
    expect(byPlayer.get('p0')).toEqual({
      playerId: 'p0',
      reason: 'league_rank',
      sourceId: 'L',
      amount: 1000,
    });
    expect(byPlayer.get('p1')?.amount).toBe(600);
    expect(byPlayer.get('p2')?.amount).toBe(400);
    // 40 oyuncunun %10'u = ilk 4 sıra. 4. sıra (p3) dahil, 5. sıra (p4) değil.
    expect(byPlayer.get('p3')).toMatchObject({ reason: 'league_rank', amount: LEAGUE_REWARDS.topTenPercent });
    expect(byPlayer.get('p4')).toMatchObject({
      reason: 'league_participation',
      amount: LEAGUE_REWARDS.participation,
    });
    expect(grants).toHaveLength(40);
  });

  it('gives nothing to members who never placed an order, even if they rank first', () => {
    const grants = computeRewards('L', standingsOf(3), new Set(['m1']));
    expect(grants).toEqual([{ playerId: 'p1', reason: 'league_rank', sourceId: 'L', amount: 600 }]);
  });

  it('gives tied players the same reward', () => {
    const tied = [
      { membershipId: 'a', playerId: 'pa', valueUnits: 5n, rank: 1 },
      { membershipId: 'b', playerId: 'pb', valueUnits: 5n, rank: 1 },
      { membershipId: 'c', playerId: 'pc', valueUnits: 4n, rank: 3 },
    ];
    expect(computeRewards('L', tied, new Set(['a', 'b', 'c'])).map((g) => g.amount)).toEqual([
      1000, 1000, 400,
    ]);
  });

  it('never grants a non-positive or cash reward', () => {
    for (const g of computeRewards('L', standingsOf(200), everyone(200))) {
      expect(g.amount).toBeGreaterThan(0);
      expect(['league_rank', 'league_participation']).toContain(g.reason);
    }
  });
});
