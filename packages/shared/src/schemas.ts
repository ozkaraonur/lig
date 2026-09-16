import { z } from 'zod';
import { ORDER_SIDES } from './domain';

/**
 * Tutarlar string olarak taşınır: JavaScript number'ı para için güvenli değildir.
 * En fazla 2 ondalık basamaklı, pozitif TL tutarı.
 */
export const moneyAmount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Tutar en fazla 12 tam ve 2 ondalık basamaklı pozitif sayı olmalı')
  .refine((v) => Number(v) > 0, 'Tutar sıfırdan büyük olmalı');

/** POST /leagues/:leagueId/orders gövdesi (FR-04, FR-33). */
export const placeOrderRequest = z.object({
  assetId: z.uuid(),
  side: z.enum(ORDER_SIDES),
  amount: moneyAmount,
  idempotencyKey: z.uuid(),
});
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
