import { type ErrorCode } from '@lig/shared';

/**
 * İstemciye gösterilmesi güvenli hata. `message` kullanıcıya gider; iç ayrıntı (hangi kontrolün
 * düştüğü, stack) asla buraya yazılmaz, sadece sunucu loguna gider.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthenticated = (message = 'Oturum bulunamadı ya da süresi doldu.') =>
  new AppError('UNAUTHENTICATED', 401, message);

export const invalidToken = () =>
  new AppError('INVALID_TOKEN', 401, 'Giriş bağlantısı geçersiz ya da süresi dolmuş.');
