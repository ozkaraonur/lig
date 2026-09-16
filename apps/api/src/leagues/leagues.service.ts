import { Inject, Injectable } from '@nestjs/common';
import {
  canJoinLeague,
  type JoinLeagueResponse,
  type LeagueAsset,
  type LeagueAssetPrice,
  type LeagueDetail,
  type LeagueMembership,
  leaguePhase,
  type LeaguePhase,
  type LeagueSummary,
} from '@lig/shared';
import { type SessionData } from '../auth/ports';
import { AppError } from '../common/app-error';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { PriceService } from '../prices/price.service';
import { LEAGUE_REPOSITORY, type LeagueRecord, type LeagueRepository, type MembershipRecord } from './ports';

/** Başka platformun ligi, taslak ya da hiç olmayan lig aynı yanıtı alır: varlığı sızdırılmaz (T4). */
export const leagueNotFound = () => new AppError('NOT_FOUND', 404, 'Lig bulunamadı.');

export const leagueNotJoinable = () => new AppError('LEAGUE_NOT_ACTIVE', 409, 'Bu lig katılıma açık değil.');

const PHASE_ORDER: Record<LeaguePhase, number> = { running: 0, upcoming: 1, ended: 2 };

@Injectable()
export class LeaguesService {
  constructor(
    @Inject(LEAGUE_REPOSITORY) private readonly leagues: LeagueRepository,
    private readonly priceService: PriceService,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  /** FR-02: süren ligler önce, sonra başlayacaklar, en sonda bitenler. */
  async list(session: SessionData): Promise<LeagueSummary[]> {
    const now = new Date(this.clock());
    const rows = await this.leagues.listVisible(session.tenantId, session.playerId, now);
    return rows.map((row) => toSummary(row, now)).sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase]);
  }

  async get(session: SessionData, leagueId: string): Promise<LeagueDetail> {
    const now = new Date(this.clock());
    const league = await this.requireLeague(session, leagueId);
    const [assets, membership] = await Promise.all([
      this.assetsWithPrices(session.tenantId, league),
      league.joined ? this.leagues.findMembership(league.id, session.playerId) : null,
    ]);
    return {
      ...toSummary(league, now),
      canJoin: !league.joined && canJoinLeague(league, now),
      assets,
      membership: membership ? toMembership(membership) : null,
    };
  }

  async latestPrices(session: SessionData, leagueId: string): Promise<LeagueAssetPrice[]> {
    const league = await this.requireLeague(session, leagueId);
    const assets = await this.orderedAssets(session.tenantId, league);
    return this.priceService.latestFor(session.tenantId, assets);
  }

  /**
   * FR-03: lige katılır ve başlangıç sanal bakiyesini verir. Tekrar çağrılırsa mevcut üyeliği döner;
   * ağ hatasında yeniden deneyen istemci ikinci bir bakiye alamaz.
   */
  async join(session: SessionData, leagueId: string): Promise<JoinLeagueResponse> {
    const league = await this.requireLeague(session, leagueId);
    const now = new Date(this.clock());

    const created = await this.leagues.createMembership(session.tenantId, league.id, session.playerId, now);
    if (created) return { created: true, membership: toMembership(created) };

    const existing = await this.leagues.findMembership(league.id, session.playerId);
    if (existing) return { created: false, membership: toMembership(existing) };

    throw leagueNotJoinable();
  }

  private async requireLeague(session: SessionData, leagueId: string): Promise<LeagueRecord> {
    const league = await this.leagues.findVisible(session.tenantId, leagueId, session.playerId);
    if (!league) throw leagueNotFound();
    return league;
  }

  /** Varlıklar ligdeki sırayla döner; tenant'a ait olmayan ya da silinmiş varlık kimliği atlanır. */
  private async orderedAssets(tenantId: string, league: LeagueRecord) {
    const found = await this.leagues.findAssets(tenantId, league.assetIds);
    const byId = new Map(found.map((a) => [a.id, a]));
    return league.assetIds.flatMap((id) => {
      const asset = byId.get(id);
      return asset ? [asset] : [];
    });
  }

  private async assetsWithPrices(tenantId: string, league: LeagueRecord): Promise<LeagueAsset[]> {
    const assets = await this.orderedAssets(tenantId, league);
    const prices = await this.priceService.latestFor(tenantId, assets);
    return assets.map((asset, i) => ({
      ...prices[i]!,
      name: asset.name,
      assetClass: asset.assetClass,
    }));
  }
}

function toSummary(row: LeagueRecord, now: Date): LeagueSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    phase: leaguePhase(row, now),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    startingCash: row.startingCash,
    memberCount: row.memberCount,
    joined: row.joined,
  };
}

function toMembership(m: MembershipRecord): LeagueMembership {
  return { cash: m.cash, joinedAt: m.joinedAt.toISOString() };
}
