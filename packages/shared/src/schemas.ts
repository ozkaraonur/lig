import { z } from 'zod';

/**
 * Tutarlar string olarak taşınır: JavaScript number'ı para için güvenli değildir.
 * En fazla 2 ondalık basamaklı, pozitif TL tutarı.
 */
export const moneyAmount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Tutar en fazla 12 tam ve 2 ondalık basamaklı pozitif sayı olmalı')
  .refine((v) => Number(v) > 0, 'Tutar sıfırdan büyük olmalı');

const orderBase = {
  assetId: z.uuid(),
  /** İstemcinin her yeni emir için ürettiği anahtar. Ağ hatasında aynı anahtarla tekrar denenir (FR-33). */
  idempotencyKey: z.uuid(),
};

/**
 * POST /leagues/:leagueId/orders gövdesi (FR-04, FR-33).
 * - Alış: `amount` TL'lik alır.
 * - Satış: `amount` TL'lik satar ya da `all: true` ile pozisyonun tamamını satar.
 * Fiyat ve miktar gövdede yoktur: sunucu belirler (T2).
 */
export const placeOrderRequest = z.union([
  z.strictObject({ ...orderBase, side: z.literal('buy'), amount: moneyAmount }),
  z.strictObject({ ...orderBase, side: z.literal('sell'), amount: moneyAmount }),
  z.strictObject({ ...orderBase, side: z.literal('sell'), all: z.literal(true) }),
]);
export type PlaceOrderRequest = z.infer<typeof placeOrderRequest>;

/** Sahte ya da gerçek platformun gönderdiği fiyat mesajı (FR-30). */
export const priceTick = z.object({
  symbol: z
    .string()
    .min(1)
    .max(16)
    .regex(/^[A-Z0-9.]+$/),
  price: z
    .string()
    .regex(/^\d{1,18}(\.\d{1,10})?$/)
    .refine((v) => /[1-9]/.test(v), 'Fiyat sıfırdan büyük olmalı'),
  /** Fiyatın platformda oluştuğu an, milisaniye (Unix epoch). */
  timestamp: z.number().int().positive(),
});
export type PriceTick = z.infer<typeof priceTick>;

/** Tek bir fiyat akışı yanıtında kabul edilen en fazla fiyat sayısı (T9). */
export const MAX_TICKS_PER_FEED_RESPONSE = 500;

/**
 * Platformun fiyat uç noktasının döndüğü gövde (FR-30). Fiyatlar burada tek tek doğrulanmaz:
 * bir sembolün bozuk gelmesi diğer bütün fiyatları düşürmesin diye alıcı her birini ayrı kontrol eder.
 */
export const priceFeedResponse = z.object({
  ticks: z.array(z.unknown()).max(MAX_TICKS_PER_FEED_RESPONSE),
});
export type PriceFeedResponse = z.infer<typeof priceFeedResponse>;
