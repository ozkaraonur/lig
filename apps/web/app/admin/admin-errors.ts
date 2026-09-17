import { ApiRequestError } from '../../lib/api';

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'E-posta ya da parola hatalı.',
  INVALID_MFA_CODE: 'Kod hatalı ya da süresi geçmiş. Uygulamadaki güncel kodu gir.',
  RATE_LIMITED: 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.',
  UNAUTHENTICATED: 'Giriş adımının süresi doldu. Baştan giriş yap.',
  VALIDATION_FAILED: 'Bilgileri kontrol et.',
  FORBIDDEN: 'Bu işlem için yetkin yok.',
  NETWORK: 'Sunucuya ulaşılamadı. API çalışıyor mu?',
};

export function adminErrorMessage(e: unknown): string {
  const code = e instanceof ApiRequestError ? e.code : 'NETWORK';
  return MESSAGES[code] ?? 'Beklenmeyen bir hata oluştu.';
}

export function isExpiredStep(e: unknown): boolean {
  return e instanceof ApiRequestError && e.code === 'UNAUTHENTICATED';
}
