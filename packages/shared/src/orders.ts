import { z } from 'zod';
import { type OrderSide } from './domain';

/** Bütün tutar ve miktarlar string: JavaScript number'ı ondalıkları tam tutamaz. */

export interface OrderView {
  id: string;
  assetId: string;
  symbol: string;
  side: OrderSide;
  /** İşlem tutarı, TL (2 ondalık). */
  amount: string;
  /** İşlemin gerçekleştiği fiyat (10 ondalık). */
  price: string;
  /** Alınan ya da satılan miktar (10 ondalık). */
  quantity: string;
  createdAt: string;
}

export interface PositionSnapshot {
  assetId: string;
  quantity: string;
  avgCost: string;
}

export interface PlaceOrderResponse {
  /** true: bu idempotency anahtarıyla daha önce işlenmiş emir döndü, yeni işlem yapılmadı. */
  replayed: boolean;
  order: OrderView;
  cash: string;
  /** Emirden sonraki pozisyon; tamamı satıldıysa null. */
  position: PositionSnapshot | null;
}

export interface PortfolioPosition extends PositionSnapshot {
  symbol: string;
  name: string;
  price: string | null;
  stale: boolean;
  /** Son fiyatla değer. Fiyat hiç yoksa maliyetle değerlenir. */
  value: string;
  /** value − maliyet, işaretli. */
  pnl: string;
  /** Kâr/zarar yüzdesi, işaretli, 2 ondalık. */
  pnlPercent: string;
}

export interface PortfolioView {
  cash: string;
  startingCash: string;
  positionsValue: string;
  totalValue: string;
  /** Başlangıç bakiyesine göre getiri yüzdesi, işaretli, 2 ondalık. */
  returnPercent: string;
  positions: PortfolioPosition[];
}

export const MAX_ORDER_HISTORY = 100;

export const orderHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_ORDER_HISTORY).default(50),
});
