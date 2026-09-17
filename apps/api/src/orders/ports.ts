import { type LeagueStatus, type LeagueType, type OrderSide } from '@lig/shared';
import { type OutboxEvent } from '../outbox/outbox';

/**
 * Emir motorunun veritabanı arayüzü. Kurallar `OrdersService` içinde; buradaki işlemler kural bilmez,
 * yalnızca okur ve yazar. Böylece her kural dalı bellek içi sahteyle test edilir, kilit ve eşzamanlılık
 * davranışı ise gerçek PostgreSQL ile (orders.int.test.ts).
 */

export interface TradingLeague {
  id: string;
  status: LeagueStatus;
  type: LeagueType;
  startsAt: Date;
  endsAt: Date;
  startingCash: string;
  assetIds: string[];
}

export interface LockedMembership {
  id: string;
  cash: string;
}

export interface PositionRecord {
  assetId: string;
  quantity: string;
  avgCost: string;
}

export interface OrderRecord {
  id: string;
  membershipId: string;
  assetId: string;
  side: OrderSide;
  amount: string;
  price: string;
  quantity: string;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}

export interface NewOrder {
  membershipId: string;
  assetId: string;
  side: OrderSide;
  amount: string;
  price: string;
  quantity: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface TradingAsset {
  id: string;
  symbol: string;
  name: string;
}

/** Tek bir veritabanı transaction'ı içinde yapılabilen işlemler. */
export interface OrderTransaction {
  /**
   * Ligi paylaşımlı kilitle okur (FOR SHARE): emir işlenirken lig kapatılamaz. Yalnızca oyuncuya görünen
   * ligler döner (tenant'ın, taslak ve arkadaş ligi değil).
   */
  lockLeague(tenantId: string, leagueId: string): Promise<TradingLeague | null>;
  /** Üyeliği özel kilitle okur (FOR UPDATE): aynı oyuncunun aynı ligdeki emirleri sırayla işlenir (T3). */
  lockMembership(leagueId: string, playerId: string): Promise<LockedMembership | null>;
  findOrderByIdempotencyKey(membershipId: string, idempotencyKey: string): Promise<OrderRecord | null>;
  findAsset(tenantId: string, assetId: string): Promise<TradingAsset | null>;
  findPosition(membershipId: string, assetId: string): Promise<PositionRecord | null>;
  setCash(membershipId: string, cash: string): Promise<void>;
  /** Miktar sıfırsa pozisyon silinir. */
  savePosition(membershipId: string, position: PositionRecord): Promise<void>;
  insertOrder(order: NewOrder): Promise<OrderRecord>;
  /** Görev worker'ı için olay (FR-07). Emirle aynı transaction'da yazılır. */
  recordEvent(event: OutboxEvent): Promise<void>;
}

export interface OrderUnitOfWork {
  /** `work` hata fırlatırsa bütün değişiklikler geri alınır. */
  run<T>(work: (tx: OrderTransaction) => Promise<T>): Promise<T>;
}

/** Portföy ve geçmiş için kilitsiz okumalar. Lig ve üyelik kontrolü LeagueRepository ile yapılır. */
export interface PortfolioReader {
  listPositions(membershipId: string): Promise<Array<PositionRecord & { symbol: string; name: string }>>;
  listOrders(membershipId: string, limit: number): Promise<Array<OrderRecord & { symbol: string }>>;
}

export const ORDER_UNIT_OF_WORK = Symbol('ORDER_UNIT_OF_WORK');
export const PORTFOLIO_READER = Symbol('PORTFOLIO_READER');
