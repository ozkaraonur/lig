import { describe, expect, it } from 'vitest';
import { createLeagueRequest, leagueEditability, updateLeagueRequest } from './admin-leagues';
import { canJoinLeague } from './leagues';

const NOW = new Date('2027-01-14T12:00:00Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('leagueEditability (FR-20)', () => {
  it('opens everything on a draft', () => {
    const rules = leagueEditability({ status: 'draft', startsAt: at(-3), endsAt: at(-1) }, 0, NOW);
    expect(Object.values(rules).every(Boolean)).toBe(true);
  });

  it('locks starting cash, unpublishing and deleting once someone joined an upcoming league', () => {
    const league = { status: 'active' as const, startsAt: at(1), endsAt: at(8) };
    expect(leagueEditability(league, 0, NOW)).toMatchObject({
      startingCash: true,
      status: true,
      delete: true,
    });
    expect(leagueEditability(league, 1, NOW)).toMatchObject({
      name: true,
      startsAt: true,
      startingCash: false,
      status: false,
      delete: false,
      removeAssets: true,
    });
  });

  it('allows only name, end, adding assets and join conditions while running', () => {
    const rules = leagueEditability({ status: 'active', startsAt: at(-1), endsAt: at(6) }, 0, NOW);
    expect(rules).toEqual({
      name: true,
      type: false,
      startsAt: false,
      endsAt: true,
      startingCash: false,
      addAssets: true,
      removeAssets: false,
      maxMembers: true,
      lateJoinAllowed: true,
      status: false,
      delete: false,
    });
  });

  it('locks everything once ended or finished', () => {
    for (const league of [
      { status: 'active' as const, startsAt: at(-8), endsAt: at(-1) },
      { status: 'finished' as const, startsAt: at(-8), endsAt: at(-1) },
    ]) {
      expect(Object.values(leagueEditability(league, 0, NOW)).some(Boolean)).toBe(false);
    }
  });
});

describe('canJoinLeague join conditions', () => {
  const running = { status: 'active' as const, startsAt: at(-1), endsAt: at(6) };
  it('respects member limit and late join', () => {
    expect(canJoinLeague({ ...running, maxMembers: 3, memberCount: 2 }, NOW)).toBe(true);
    expect(canJoinLeague({ ...running, maxMembers: 3, memberCount: 3 }, NOW)).toBe(false);
    expect(canJoinLeague({ ...running, lateJoinAllowed: false }, NOW)).toBe(false);
    expect(canJoinLeague({ ...running, startsAt: at(1), lateJoinAllowed: false }, NOW)).toBe(true);
  });
});

describe('league request schemas', () => {
  const valid = {
    name: 'Kasım Ligi',
    type: 'weekly',
    startsAt: at(1).toISOString(),
    endsAt: at(8).toISOString(),
    startingCash: '100000',
    assetIds: ['11111111-1111-4111-8111-111111111111'],
  };

  it('fills defaults and parses dates', () => {
    const parsed = createLeagueRequest.parse(valid);
    expect(parsed).toMatchObject({ maxMembers: null, lateJoinAllowed: true, publish: false });
    expect(parsed.startsAt).toBeInstanceOf(Date);
  });

  it.each([
    ['a cash reward field (FR-24)', { cashReward: '1000' }],
    ['a friends league', { type: 'friends' }],
    ['HTML in the name', { name: '<script>x</script>' }],
    ['a too small balance', { startingCash: '99' }],
    ['negative balance', { startingCash: '-5' }],
    ['no assets', { assetIds: [] }],
    ['duplicate assets', { assetIds: [valid.assetIds[0], valid.assetIds[0]] }],
    ['a member limit of 1', { maxMembers: 1 }],
    ['a date without timezone', { startsAt: '2027-01-15T00:00:00' }],
  ])('rejects %s', (_label, change) => {
    expect(createLeagueRequest.safeParse({ ...valid, ...change }).success).toBe(false);
  });

  it('rejects an empty update and unknown fields', () => {
    expect(updateLeagueRequest.safeParse({}).success).toBe(false);
    expect(updateLeagueRequest.safeParse({ status: 'finished' }).success).toBe(false);
    expect(updateLeagueRequest.safeParse({ closedAt: at(0).toISOString() }).success).toBe(false);
    expect(updateLeagueRequest.safeParse({ name: 'Yeni ad' }).success).toBe(true);
  });
});
