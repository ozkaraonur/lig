import { describe, expect, it } from 'vitest';
import { MAX_PRICE_AGE_MS } from './domain';
import { canJoinLeague, isPriceStale, leaguePhase } from './leagues';

const startsAt = new Date('2026-09-14T00:00:00Z');
const endsAt = new Date('2026-09-21T00:00:00Z');
const active = { status: 'active' as const, startsAt, endsAt };

describe('leaguePhase', () => {
  it('is upcoming before the start', () => {
    expect(leaguePhase(active, new Date('2026-09-13T23:59:59Z'))).toBe('upcoming');
  });

  it('is running from the exact start until just before the end', () => {
    expect(leaguePhase(active, startsAt)).toBe('running');
    expect(leaguePhase(active, new Date(endsAt.getTime() - 1))).toBe('running');
  });

  it('is ended at the exact end time', () => {
    expect(leaguePhase(active, endsAt)).toBe('ended');
  });

  it('is ended when an admin finished it early', () => {
    expect(leaguePhase({ ...active, status: 'finished' }, new Date('2026-09-15T00:00:00Z'))).toBe('ended');
  });
});

describe('canJoinLeague', () => {
  const during = new Date('2026-09-15T00:00:00Z');

  it('allows joining an upcoming or running league', () => {
    expect(canJoinLeague(active, new Date('2026-09-01T00:00:00Z'))).toBe(true);
    expect(canJoinLeague(active, during)).toBe(true);
  });

  it('rejects draft, finished and ended leagues', () => {
    expect(canJoinLeague({ ...active, status: 'draft' }, during)).toBe(false);
    expect(canJoinLeague({ ...active, status: 'finished' }, during)).toBe(false);
    expect(canJoinLeague(active, endsAt)).toBe(false);
  });
});

describe('isPriceStale', () => {
  it('treats a price exactly at the limit as fresh', () => {
    expect(isPriceStale(1_000, 1_000 + MAX_PRICE_AGE_MS)).toBe(false);
    expect(isPriceStale(1_000, 1_000 + MAX_PRICE_AGE_MS + 1)).toBe(true);
  });
});
