import { Inject, Injectable } from '@nestjs/common';
import { type OrderView, type PortfolioPosition, type PortfolioView } from '@lig/shared';
import { type SessionData } from '../auth/ports';
import { LEAGUE_REPOSITORY, type LeagueRepository } from '../leagues/ports';
import { PriceService } from '../prices/price.service';
import { CASH_SCALE, formatFixed, parseFixed, PRICE_SCALE, QUANTITY_SCALE } from './fixed-point';
import { quantityValue, returnPercentUnits } from './order-math';
import { orderErrors, toOrderView } from './orders.service';
import { PORTFOLIO_READER, type PortfolioReader } from './ports';

/** Portföy ve getiri (FR-05). Değerleme her istekte son fiyatla yapılır; hiçbir değer istemciden gelmez. */
@Injectable()
export class PortfolioService {
  constructor(
    @Inject(LEAGUE_REPOSITORY) private readonly leagues: LeagueRepository,
    @Inject(PORTFOLIO_READER) private readonly reader: PortfolioReader,
    private readonly prices: PriceService,
  ) {}

  async portfolio(session: SessionData, leagueId: string): Promise<PortfolioView> {
    const { league, membership } = await this.requireMembership(session, leagueId);
    const held = await this.reader.listPositions(membership.id);
    const quotes = await this.prices.latestFor(
      session.tenantId,
      held.map((p) => ({ id: p.assetId, symbol: p.symbol })),
    );

    let positionsValue = 0n;
    const positions: PortfolioPosition[] = held.map((p, i) => {
      const quote = quotes[i];
      const quantity = parseFixed(p.quantity, QUANTITY_SCALE);
      const avgCost = parseFixed(p.avgCost, PRICE_SCALE);
      // Fiyat hiç gelmediyse pozisyon maliyetinden değerlenir: sıralama boş fiyat yüzünden sıfırlanmaz.
      const valuationPrice = quote?.price ? parseFixed(quote.price, PRICE_SCALE) : avgCost;
      const value = quantityValue(quantity, valuationPrice);
      const cost = quantityValue(quantity, avgCost);
      positionsValue += value;
      return {
        assetId: p.assetId,
        symbol: p.symbol,
        name: p.name,
        quantity: formatFixed(quantity, QUANTITY_SCALE),
        avgCost: formatFixed(avgCost, PRICE_SCALE),
        price: quote?.price ? formatFixed(valuationPrice, PRICE_SCALE) : null,
        stale: quote?.stale ?? true,
        value: formatFixed(value, CASH_SCALE),
        pnl: formatFixed(value - cost, CASH_SCALE),
        pnlPercent: formatFixed(returnPercentUnits(value, cost), 2),
      };
    });

    const cash = parseFixed(membership.cash, CASH_SCALE);
    const startingCash = parseFixed(league.startingCash, CASH_SCALE);
    const totalValue = cash + positionsValue;

    return {
      cash: formatFixed(cash, CASH_SCALE),
      startingCash: formatFixed(startingCash, CASH_SCALE),
      positionsValue: formatFixed(positionsValue, CASH_SCALE),
      totalValue: formatFixed(totalValue, CASH_SCALE),
      returnPercent: formatFixed(returnPercentUnits(totalValue, startingCash), 2),
      positions,
    };
  }

  async history(session: SessionData, leagueId: string, limit: number): Promise<OrderView[]> {
    const { membership } = await this.requireMembership(session, leagueId);
    const orders = await this.reader.listOrders(membership.id, limit);
    return orders.map((o) => toOrderView(o, o.symbol));
  }

  private async requireMembership(session: SessionData, leagueId: string) {
    const league = await this.leagues.findVisible(session.tenantId, leagueId, session.playerId);
    if (!league) throw orderErrors.leagueNotFound();
    const membership = await this.leagues.findMembership(league.id, session.playerId);
    if (!membership) throw orderErrors.notAMember();
    return { league, membership };
  }
}
