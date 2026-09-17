import { CASH_SCALE, parseFixed, PRICE_SCALE, QUANTITY_SCALE } from './fixed-point';
import { quantityValue } from './order-math';

/**
 * Portföy değerlemesinin tek kaynağı. Portföy ekranı (FR-05), sıralama (FR-06) ve lig kapanışı (FR-32)
 * aynı fonksiyonu kullanır; oyuncunun gördüğü toplam değer ile sıralamadaki değer hiçbir zaman ayrışmaz.
 */

export interface PositionToValue {
  quantity: string;
  avgCost: string;
  /** Son bilinen fiyat (bayat olabilir). Hiç fiyat yoksa null. */
  price: string | null;
}

export interface PositionValuation {
  quantityUnits: bigint;
  avgCostUnits: bigint;
  /** Değerlemede kullanılan fiyat: son fiyat, yoksa ortalama maliyet. */
  priceUnits: bigint;
  valueUnits: bigint;
  costUnits: bigint;
}

export function valuePosition(position: PositionToValue): PositionValuation {
  const quantityUnits = parseFixed(position.quantity, QUANTITY_SCALE);
  const avgCostUnits = parseFixed(position.avgCost, PRICE_SCALE);
  // Fiyat hiç gelmediyse maliyetten değerlenir: fiyat akışı başlamadan sıralama sıfırlanmaz.
  const priceUnits = position.price ? parseFixed(position.price, PRICE_SCALE) : avgCostUnits;
  return {
    quantityUnits,
    avgCostUnits,
    priceUnits,
    valueUnits: quantityValue(quantityUnits, priceUnits),
    costUnits: quantityValue(quantityUnits, avgCostUnits),
  };
}

/** Nakit + pozisyonların değeri, kuruş cinsinden. */
export function totalValueUnits(cash: string, positions: PositionToValue[]): bigint {
  return positions.reduce((sum, p) => sum + valuePosition(p).valueUnits, parseFixed(cash, CASH_SCALE));
}
