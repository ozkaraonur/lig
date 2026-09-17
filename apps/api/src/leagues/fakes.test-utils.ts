import { randomUUID } from 'node:crypto';
import { type AssetClass, type LeagueStatus, type LeagueType } from '@lig/shared';
import { type AssetRecord, type LeagueRecord, type LeagueRepository, type MembershipRecord } from './ports';

export interface StoredLeague {
  id: string;
  tenantId: string;
  name: string;
  type: LeagueType;
  status: LeagueStatus;
  startsAt: Date;
  endsAt: Date;
  startingCash: string;
  assetIds: string[];
  closingPrices?: Record<string, string | null> | null;
}

/**
 * Drizzle deposunun kurallarını bellekte taklit eder. Kuralların SQL'de de aynı olduğu
 * drizzle-league.repository.int.test.ts ile gerçek veritabanında ayrıca sınanır.
 */
export class InMemoryLeagueRepository implements LeagueRepository {
  readonly leagues: StoredLeague[] = [];
  readonly assets: Array<AssetRecord & { tenantId: string }> = [];
  readonly memberships: MembershipRecord[] = [];
  readonly players = new Map<string, string>();
  readonly events: Array<{ tenantId: string; playerId: string; type: 'league_joined' }> = [];

  addPlayer(tenantId: string, playerId = randomUUID()): string {
    this.players.set(playerId, tenantId);
    return playerId;
  }

  addAsset(tenantId: string, symbol: string, assetClass: AssetClass = 'crypto'): AssetRecord {
    const asset = { id: randomUUID(), tenantId, symbol, name: symbol, assetClass };
    this.assets.push(asset);
    return asset;
  }

  addLeague(league: Partial<StoredLeague> & { tenantId: string }): StoredLeague {
    const stored: StoredLeague = {
      id: randomUUID(),
      name: 'Lig',
      type: 'weekly',
      status: 'active',
      startsAt: new Date('2027-01-11T00:00:00Z'),
      endsAt: new Date('2027-01-18T00:00:00Z'),
      startingCash: '100000.00',
      assetIds: [],
      ...league,
    };
    this.leagues.push(stored);
    return stored;
  }

  async listVisible(tenantId: string, playerId: string): Promise<LeagueRecord[]> {
    return this.leagues.filter((l) => this.isVisible(l, tenantId)).map((l) => this.toRecord(l, playerId));
  }

  async findVisible(tenantId: string, leagueId: string, playerId: string): Promise<LeagueRecord | null> {
    const league = this.leagues.find((l) => l.id === leagueId && this.isVisible(l, tenantId));
    return league ? this.toRecord(league, playerId) : null;
  }

  async findAssets(tenantId: string, assetIds: string[]): Promise<AssetRecord[]> {
    return this.assets
      .filter((a) => a.tenantId === tenantId && assetIds.includes(a.id))
      .map(({ tenantId: _t, ...asset }) => asset);
  }

  async findMembership(leagueId: string, playerId: string): Promise<MembershipRecord | null> {
    return this.memberships.find((m) => m.leagueId === leagueId && m.playerId === playerId) ?? null;
  }

  async createMembership(
    tenantId: string,
    leagueId: string,
    playerId: string,
    now: Date,
  ): Promise<MembershipRecord | null> {
    const league = this.leagues.find(
      (l) =>
        l.id === leagueId &&
        l.tenantId === tenantId &&
        l.status === 'active' &&
        l.type !== 'friends' &&
        l.endsAt > now,
    );
    if (!league || this.players.get(playerId) !== tenantId) return null;
    if (await this.findMembership(leagueId, playerId)) return null;

    const membership = { id: randomUUID(), leagueId, playerId, cash: league.startingCash, joinedAt: now };
    this.memberships.push(membership);
    this.events.push({ tenantId, playerId, type: 'league_joined' });
    return membership;
  }

  private isVisible(l: StoredLeague, tenantId: string): boolean {
    return l.tenantId === tenantId && l.status !== 'draft' && l.type !== 'friends';
  }

  private toRecord(l: StoredLeague, playerId: string): LeagueRecord {
    const members = this.memberships.filter((m) => m.leagueId === l.id);
    return {
      ...l,
      closingPrices: l.closingPrices ?? null,
      memberCount: members.length,
      joined: members.some((m) => m.playerId === playerId),
    };
  }
}
