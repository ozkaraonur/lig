import { Inject, Injectable } from '@nestjs/common';
import { type LeaderboardEntry, type LeaderboardView } from '@lig/shared';
import { type SessionData } from '../auth/ports';
import { AppError } from '../common/app-error';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { LEAGUE_REPOSITORY, type LeagueRecord, type LeagueRepository } from '../leagues/ports';
import { CASH_SCALE, formatFixed, parseFixed } from '../orders/fixed-point';
import { returnPercentUnits } from '../orders/order-math';
import { PriceService } from '../prices/price.service';
import {
  FINAL_STANDINGS_READER,
  type FinalStandingsReader,
  type RankableLeague,
  RANKING_SOURCE,
  RANKING_STORE,
  type RankingSource,
  type RankingStore,
} from './ports';
import { computeStandings, type MemberHolding, type Standing } from './standings';

/** Üyelerin pozisyonlarındaki varlıkların son fiyatlarını tek seferde okur. */
export async function pricesForHoldings(
  prices: PriceService,
  tenantId: string,
  holdings: MemberHolding[],
): Promise<Map<string, string | null>> {
  const assets = new Map<string, { id: string; symbol: string }>();
  for (const h of holdings)
    for (const p of h.positions) assets.set(p.assetId, { id: p.assetId, symbol: p.symbol });
  const quotes = await prices.latestFor(tenantId, [...assets.values()]);
  return new Map(quotes.map((q) => [q.assetId, q.price]));
}

@Injectable()
export class RankingService {
  constructor(
    @Inject(RANKING_SOURCE) private readonly source: RankingSource,
    @Inject(RANKING_STORE) private readonly store: RankingStore,
    @Inject(FINAL_STANDINGS_READER) private readonly finals: FinalStandingsReader,
    @Inject(LEAGUE_REPOSITORY) private readonly leagues: LeagueRepository,
    private readonly prices: PriceService,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  /** Süren bir ligin sıralamasını son fiyatlarla yeniden hesaplar ve Redis'e yazar. */
  async recompute(league: RankableLeague): Promise<Standing[]> {
    const holdings = await this.source.loadHoldings(league.id);
    const priceByAsset = await pricesForHoldings(this.prices, league.tenantId, holdings);
    const standings = computeStandings(holdings, priceByAsset);
    await this.store.replace(league.id, standings, this.clock());
    return standings;
  }

  /** FR-06: ilk N oyuncu ve oyuncunun kendi satırı. Kapanmış ligde dondurulmuş sonuç (FR-32). */
  async leaderboard(session: SessionData, leagueId: string, limit: number): Promise<LeaderboardView> {
    const league = await this.leagues.findVisible(session.tenantId, leagueId, session.playerId);
    if (!league) throw new AppError('NOT_FOUND', 404, 'Lig bulunamadı.');
    return league.status === 'finished'
      ? this.finalLeaderboard(session, league, limit)
      : this.liveLeaderboard(session, league, limit);
  }

  private async liveLeaderboard(
    session: SessionData,
    league: LeagueRecord,
    limit: number,
  ): Promise<LeaderboardView> {
    const [top, mine, count, updatedAt] = await Promise.all([
      this.store.top(league.id, limit),
      league.joined ? this.store.entryFor(league.id, session.playerId) : null,
      this.store.count(league.id),
      this.store.updatedAt(league.id),
    ]);
    const names = await this.source.displayNames([
      ...top.map((e) => e.playerId),
      ...(mine ? [mine.playerId] : []),
    ]);
    const entry = (e: { playerId: string; valueUnits: bigint; rank: number }): LeaderboardEntry =>
      this.toEntry(league, session, e.playerId, names.get(e.playerId) ?? 'Oyuncu', e.rank, e.valueUnits);

    return {
      final: false,
      updatedAt: updatedAt === null ? null : new Date(updatedAt).toISOString(),
      playerCount: count,
      top: top.map(entry),
      me: mine ? { ...entry(mine), xpAwarded: null } : null,
    };
  }

  private async finalLeaderboard(
    session: SessionData,
    league: LeagueRecord,
    limit: number,
  ): Promise<LeaderboardView> {
    const [top, mine, count, xp] = await Promise.all([
      this.finals.top(league.id, limit),
      league.joined ? this.finals.entryFor(league.id, session.playerId) : null,
      this.finals.count(league.id),
      league.joined ? this.finals.xpAwarded(league.id, session.playerId) : 0,
    ]);
    const entry = (r: { playerId: string; displayName: string; finalRank: number; finalValue: string }) =>
      this.toEntry(
        league,
        session,
        r.playerId,
        r.displayName,
        r.finalRank,
        parseFixed(r.finalValue, CASH_SCALE),
      );

    return {
      final: true,
      updatedAt: null,
      playerCount: count,
      top: top.map(entry),
      me: mine ? { ...entry(mine), xpAwarded: xp } : null,
    };
  }

  private toEntry(
    league: LeagueRecord,
    session: SessionData,
    playerId: string,
    displayName: string,
    rank: number,
    valueUnits: bigint,
  ): LeaderboardEntry {
    const start = parseFixed(league.startingCash, CASH_SCALE);
    return {
      rank,
      displayName,
      totalValue: formatFixed(valueUnits, CASH_SCALE),
      returnPercent: formatFixed(returnPercentUnits(valueUnits, start), 2),
      isMe: playerId === session.playerId,
    };
  }
}
