import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  leaguePhase,
  MARKET_PHASE_LABELS,
  marketStatus,
  type OrderView,
  type PlaceOrderRequest,
  type PlaceOrderResponse,
  type PositionSnapshot,
} from '@lig/shared';
import { type SessionData } from '../auth/ports';
import { AppError } from '../common/app-error';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { PriceService } from '../prices/price.service';
import { CASH_SCALE, formatFixed, parseFixed, PRICE_SCALE, QUANTITY_SCALE } from './fixed-point';
import { averageCostAfterBuy, buyQuantity, quantityValue, sellQuantityForAmount } from './order-math';
import {
  type OrderRecord,
  type OrderTransaction,
  ORDER_UNIT_OF_WORK,
  type OrderUnitOfWork,
  type PositionRecord,
  type TradingAsset,
} from './ports';

export const orderErrors = {
  leagueNotFound: () => new AppError('NOT_FOUND', 404, 'Lig bulunamadı.'),
  notAMember: () => new AppError('NOT_A_MEMBER', 403, 'Emir vermek için önce lige katıl.'),
  leagueNotActive: () => new AppError('LEAGUE_NOT_ACTIVE', 409, 'Bu ligde şu an işlem yapılamaz.'),
  assetNotInLeague: () => new AppError('ASSET_NOT_IN_LEAGUE', 422, 'Bu varlık bu ligde işlem görmüyor.'),
  priceStale: () =>
    new AppError('PRICE_STALE', 409, 'Güncel fiyat alınamadı. Birkaç saniye sonra tekrar dene.', {
      'retry-after': '2',
    }),
  insufficientCash: () => new AppError('INSUFFICIENT_CASH', 422, 'Sanal bakiyen bu emir için yetmiyor.'),
  noPosition: () => new AppError('NO_POSITION', 422, 'Bu varlıktan satacak kadar pozisyonun yok.'),
  orderTooSmall: () => new AppError('ORDER_TOO_SMALL', 422, 'Tutar bu fiyatta işlem yapmak için çok küçük.'),
  idempotencyKeyReused: () =>
    new AppError('IDEMPOTENCY_KEY_REUSED', 409, 'Bu emir anahtarı farklı bir emir için kullanılmış.'),
  marketClosed: (phase: string, opensAt: string | null) =>
    new AppError(
      'MARKET_CLOSED',
      409,
      `${phase}. Hisse emirleri yalnızca seans saatinde verilebilir${
        opensAt ? `; seans ${formatOpening(opensAt)} açılıyor` : ''
      }.`,
    ),
};

/** Hata mesajındaki açılış saati Türkiye saatiyle yazılır. */
function formatOpening(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * İsteğin özeti. Aynı idempotency anahtarı aynı istekle gelirse önceki sonuç döner; farklı bir istekle
 * gelirse reddedilir. Aksi halde "ağ hatası tekrarı" görünümünde farklı bir emir sessizce yutulurdu.
 */
export function orderRequestHash(req: PlaceOrderRequest): string {
  const canonical = JSON.stringify([req.assetId, req.side, 'amount' in req ? req.amount : 'all']);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Emir motoru (FR-04, FR-33). Tasarım dosyasındaki activity diyagramının sırası:
 * lig görünür mü → üye mi → aynı anahtarla önceki emir → lig işlemde mi → varlık ligde mi →
 * fiyat taze mi → bakiye/pozisyon yeterli mi → yaz.
 *
 * Hepsi tek transaction'da, lig paylaşımlı ve üyelik özel kilitli. Fiyat istemciden alınmaz (T2).
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(ORDER_UNIT_OF_WORK) private readonly uow: OrderUnitOfWork,
    private readonly prices: PriceService,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  async place(session: SessionData, leagueId: string, req: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    const requestHash = orderRequestHash(req);

    return this.uow.run(async (tx) => {
      const league = await tx.lockLeague(session.tenantId, leagueId);
      if (!league) throw orderErrors.leagueNotFound();

      const membership = await tx.lockMembership(league.id, session.playerId);
      if (!membership) throw orderErrors.notAMember();

      const existing = await tx.findOrderByIdempotencyKey(membership.id, req.idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) throw orderErrors.idempotencyKeyReused();
        const asset = await tx.findAsset(session.tenantId, existing.assetId);
        const position = await tx.findPosition(membership.id, existing.assetId);
        return {
          replayed: true,
          order: toOrderView(existing, asset?.symbol ?? ''),
          cash: normalizeCash(membership.cash),
          position: position ? toPositionSnapshot(position) : null,
        };
      }

      const now = new Date(this.clock());
      if (league.status !== 'active' || leaguePhase(league, now) !== 'running') {
        throw orderErrors.leagueNotActive();
      }

      if (!league.assetIds.includes(req.assetId)) throw orderErrors.assetNotInLeague();
      const asset = await tx.findAsset(session.tenantId, req.assetId);
      if (!asset) throw orderErrors.assetNotInLeague();
      if (asset.assetClass === 'equity') {
        // Pay piyasası seans saati (7. adım). Kripto varlıklar 7/24 açık.
        const market = marketStatus(new Date(this.clock()));
        if (!market.open) {
          throw orderErrors.marketClosed(MARKET_PHASE_LABELS[market.phase], market.opensAt);
        }
      }

      const [quote] = await this.prices.latestFor(session.tenantId, [asset]);
      if (!quote?.price || quote.stale) throw orderErrors.priceStale();

      const priceUnits = parseFixed(quote.price, PRICE_SCALE);
      const cashUnits = parseFixed(membership.cash, CASH_SCALE);
      const position = await tx.findPosition(membership.id, asset.id);

      const result =
        req.side === 'buy'
          ? await this.buy(tx, membership.id, asset, cashUnits, priceUnits, position, req.amount)
          : await this.sell(tx, membership.id, asset, cashUnits, priceUnits, position, req);

      const order = await tx.insertOrder({
        membershipId: membership.id,
        assetId: asset.id,
        side: req.side,
        amount: formatFixed(result.amountUnits, CASH_SCALE),
        price: formatFixed(priceUnits, PRICE_SCALE),
        quantity: formatFixed(result.quantityUnits, QUANTITY_SCALE),
        idempotencyKey: req.idempotencyKey,
        requestHash,
      });
      await tx.recordEvent({ tenantId: session.tenantId, playerId: session.playerId, type: 'order_placed' });

      return {
        replayed: false,
        order: toOrderView(order, asset.symbol),
        cash: formatFixed(result.cashAfterUnits, CASH_SCALE),
        position: result.positionAfter ? toPositionSnapshot(result.positionAfter) : null,
      };
    });
  }

  private async buy(
    tx: OrderTransaction,
    membershipId: string,
    asset: TradingAsset,
    cashUnits: bigint,
    priceUnits: bigint,
    position: PositionRecord | null,
    amount: string,
  ) {
    const amountUnits = parseFixed(amount, CASH_SCALE);
    if (amountUnits > cashUnits) throw orderErrors.insufficientCash();

    const quantityUnits = buyQuantity(amountUnits, priceUnits);
    if (quantityUnits === 0n) throw orderErrors.orderTooSmall();

    const oldQuantity = position ? parseFixed(position.quantity, QUANTITY_SCALE) : 0n;
    const oldAvg = position ? parseFixed(position.avgCost, PRICE_SCALE) : 0n;
    const positionAfter: PositionRecord = {
      assetId: asset.id,
      quantity: formatFixed(oldQuantity + quantityUnits, QUANTITY_SCALE),
      avgCost: formatFixed(averageCostAfterBuy(oldQuantity, oldAvg, amountUnits, quantityUnits), PRICE_SCALE),
    };
    const cashAfterUnits = cashUnits - amountUnits;

    await tx.setCash(membershipId, formatFixed(cashAfterUnits, CASH_SCALE));
    await tx.savePosition(membershipId, positionAfter);
    return { amountUnits, quantityUnits, cashAfterUnits, positionAfter };
  }

  private async sell(
    tx: OrderTransaction,
    membershipId: string,
    asset: TradingAsset,
    cashUnits: bigint,
    priceUnits: bigint,
    position: PositionRecord | null,
    req: Extract<PlaceOrderRequest, { side: 'sell' }>,
  ) {
    const heldUnits = position ? parseFixed(position.quantity, QUANTITY_SCALE) : 0n;
    if (!position || heldUnits === 0n) throw orderErrors.noPosition();

    let amountUnits: bigint;
    let quantityUnits: bigint;
    if ('all' in req) {
      quantityUnits = heldUnits;
      amountUnits = quantityValue(heldUnits, priceUnits);
    } else {
      amountUnits = parseFixed(req.amount, CASH_SCALE);
      quantityUnits = sellQuantityForAmount(amountUnits, priceUnits);
      if (quantityUnits > heldUnits) throw orderErrors.noPosition();
    }
    if (amountUnits === 0n || quantityUnits === 0n) throw orderErrors.orderTooSmall();

    const remaining = heldUnits - quantityUnits;
    const positionAfter: PositionRecord | null =
      remaining === 0n
        ? null
        : { assetId: asset.id, quantity: formatFixed(remaining, QUANTITY_SCALE), avgCost: position.avgCost };
    const cashAfterUnits = cashUnits + amountUnits;

    await tx.setCash(membershipId, formatFixed(cashAfterUnits, CASH_SCALE));
    await tx.savePosition(membershipId, positionAfter ?? { assetId: asset.id, quantity: '0', avgCost: '0' });
    return { amountUnits, quantityUnits, cashAfterUnits, positionAfter };
  }
}

function normalizeCash(cash: string): string {
  return formatFixed(parseFixed(cash, CASH_SCALE), CASH_SCALE);
}

export function toOrderView(order: OrderRecord, symbol: string): OrderView {
  return {
    id: order.id,
    assetId: order.assetId,
    symbol,
    side: order.side,
    amount: formatFixed(parseFixed(order.amount, CASH_SCALE), CASH_SCALE),
    price: formatFixed(parseFixed(order.price, PRICE_SCALE), PRICE_SCALE),
    quantity: formatFixed(parseFixed(order.quantity, QUANTITY_SCALE), QUANTITY_SCALE),
    createdAt: order.createdAt.toISOString(),
  };
}

function toPositionSnapshot(p: PositionRecord): PositionSnapshot {
  return {
    assetId: p.assetId,
    quantity: formatFixed(parseFixed(p.quantity, QUANTITY_SCALE), QUANTITY_SCALE),
    avgCost: formatFixed(parseFixed(p.avgCost, PRICE_SCALE), PRICE_SCALE),
  };
}
