import { CASH_SCALE, divide, pow10, PRICE_SCALE, QUANTITY_SCALE } from './fixed-point';

/**
 * Emir hesapları. Bütün değerler ölçeklenmiş tam sayı (bkz. fixed-point.ts).
 *
 * Yuvarlama kuralı: yuvarlama farkı her zaman oyuncunun lehine değil, "kasanın" lehine.
 * Aksi halde çok sayıda küçük emirle yuvarlamadan bedava para ya da miktar üretilebilir.
 */

/** TL × 10^CASH ÷ (fiyat × 10^PRICE) → miktar × 10^QTY için gereken çarpan. */
const AMOUNT_TO_QUANTITY = pow10(QUANTITY_SCALE + PRICE_SCALE - CASH_SCALE);
/** miktar × fiyat → TL için bölen. */
const QUANTITY_PRICE_TO_CASH = pow10(QUANTITY_SCALE + PRICE_SCALE - CASH_SCALE);

/** Alış: ödenen tutarla alınacak miktar, aşağı yuvarlanır. */
export function buyQuantity(amountUnits: bigint, priceUnits: bigint): bigint {
  return divide(amountUnits * AMOUNT_TO_QUANTITY, priceUnits, 'floor');
}

/** Tutarla satış: bu tutarı almak için verilmesi gereken miktar, yukarı yuvarlanır. */
export function sellQuantityForAmount(amountUnits: bigint, priceUnits: bigint): bigint {
  return divide(amountUnits * AMOUNT_TO_QUANTITY, priceUnits, 'ceil');
}

/** Miktarın TL karşılığı, aşağı yuvarlanır. Tümünü satışta gelir ve portföy değeri için. */
export function quantityValue(quantityUnits: bigint, priceUnits: bigint): bigint {
  return divide(quantityUnits * priceUnits, QUANTITY_PRICE_TO_CASH, 'floor');
}

/**
 * Alış sonrası ortalama maliyet (fiyat ölçeğinde). Toplam ödenen tutar ÷ toplam miktar, yukarı yuvarlanır:
 * kâr/zarar gösterimi oyuncuya olduğundan iyi görünmez.
 */
export function averageCostAfterBuy(
  oldQuantityUnits: bigint,
  oldAverageCostUnits: bigint,
  paidAmountUnits: bigint,
  boughtQuantityUnits: bigint,
): bigint {
  const newQuantity = oldQuantityUnits + boughtQuantityUnits;
  if (newQuantity === 0n) return 0n;
  // Ölçek: miktar(10) × fiyat(10) = 20; tutar(2) × 10^18 = 20. Toplam ÷ miktar(10) = fiyat ölçeği (10).
  const oldCost = oldQuantityUnits * oldAverageCostUnits;
  const paid = paidAmountUnits * AMOUNT_TO_QUANTITY;
  return divide(oldCost + paid, newQuantity, 'ceil');
}

/**
 * Getiri yüzdesi, 2 ondalık (ölçek 2 tam sayı, işaretli). Örn. %12,34 → 1234n.
 * Sıfıra doğru yuvarlanır.
 */
export function returnPercentUnits(currentValueUnits: bigint, startingValueUnits: bigint): bigint {
  if (startingValueUnits <= 0n) return 0n;
  const diff = currentValueUnits - startingValueUnits;
  // yüzde × 100 = diff × 10000 / başlangıç
  return (diff * 10_000n) / startingValueUnits;
}
