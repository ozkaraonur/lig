import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { PriceService } from '../prices/price.service';
import { LEAGUE_CLOSE_UOW, type LeagueCloseUnitOfWork, RANKING_STORE, type RankingStore } from './ports';
import { pricesForHoldings } from './ranking.service';
import { computeRewards, computeStandings } from './standings';

export type CloseResult =
  | { closed: true; players: number; xpGranted: number }
  | { closed: false; reason: 'not_found' | 'not_active' | 'not_ended' };

/**
 * Lig kapanışı (FR-32): süre dolunca sıralamayı dondurur, XP ödüllerini dağıtır, ligi kapatır.
 *
 * Tek transaction'da ve lig özel kilitliyken yapılır. İki süreç aynı anda kapatmaya çalışsa ikincisi
 * kilidi bekler, ligi kapanmış bulur ve hiçbir şey yapmaz. XP defteri (oyuncu, sebep, lig) tekil
 * olduğundan kapanış bir hata sonrası tekrar çalışsa bile ödül iki kez verilmez.
 */
@Injectable()
export class LeagueCloseService {
  private readonly logger = new Logger(LeagueCloseService.name);

  constructor(
    @Inject(LEAGUE_CLOSE_UOW) private readonly uow: LeagueCloseUnitOfWork,
    @Inject(RANKING_STORE) private readonly store: RankingStore,
    private readonly prices: PriceService,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  async close(leagueId: string): Promise<CloseResult> {
    const result = await this.uow.run(async (tx): Promise<CloseResult> => {
      const now = new Date(this.clock());
      const league = await tx.lockLeague(leagueId);
      if (!league) return { closed: false, reason: 'not_found' };
      if (league.status !== 'active') return { closed: false, reason: 'not_active' };
      if (league.endsAt > now) return { closed: false, reason: 'not_ended' };

      // Emirler bitiş anında durduğu için pozisyonlar sabit. Değerleme kapanış anındaki son fiyatlarla yapılır.
      const holdings = await tx.loadHoldings(league.id);
      const priceByAsset = await pricesForHoldings(this.prices, league.tenantId, holdings);
      const standings = computeStandings(holdings, priceByAsset);
      const traded = await tx.membershipsWithOrders(league.id);

      await tx.saveFinalStandings(standings);
      // Arkadaş ligi XP vermez: iki hesapla kasten kaybedip XP taşımak mümkün olurdu (K-017, K-033).
      const xpGranted =
        league.type === 'friends' ? 0 : await tx.grantXp(computeRewards(league.id, standings, traded));
      await tx.markClosed(league.id, now, Object.fromEntries(priceByAsset));
      if (league.type === 'tier' && league.tier) await tx.applyTierMovements(league.id, league.tier);
      await tx.enqueueBadgeChecks(league.id);
      return { closed: true, players: standings.length, xpGranted };
    });

    if (result.closed) {
      await this.store.remove(leagueId).catch(() => undefined);
      this.logger.log(`League ${leagueId} closed: ${result.players} players, ${result.xpGranted} XP granted`);
    }
    return result;
  }
}
