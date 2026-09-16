/**
 * API'nin oyuncuya döndüğü hata kodları. Arayüz mesajı bu koda göre seçer;
 * iç detay (stack, SQL) asla istemciye gitmez.
 */
export const ERROR_CODES = {
  LEAGUE_NOT_ACTIVE: 'LEAGUE_NOT_ACTIVE',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  PRICE_STALE: 'PRICE_STALE',
  INSUFFICIENT_CASH: 'INSUFFICIENT_CASH',
  NO_POSITION: 'NO_POSITION',
  ASSET_NOT_IN_LEAGUE: 'ASSET_NOT_IN_LEAGUE',
  INVALID_TOKEN: 'INVALID_TOKEN',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiError {
  code: ErrorCode;
  message: string;
}
