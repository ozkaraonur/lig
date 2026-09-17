import { ApiRequestError } from '../../lib/api';

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'E-posta ya da parola hatalı.',
  INVALID_MFA_CODE: 'Kod hatalı ya da süresi geçmiş. Uygulamadaki güncel kodu gir.',
  RATE_LIMITED: 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.',
  UNAUTHENTICATED: 'Giriş adımının süresi doldu. Baştan giriş yap.',
  VALIDATION_FAILED: 'Bilgileri kontrol et.',
  FORBIDDEN: 'Bu işlem için yetkin yok.',
  LAST_OWNER: 'Platformda en az bir sahip kalmalı. Önce başka birini sahip yap.',
  INVITE_INVALID: 'Davet linki geçersiz, süresi dolmuş ya da daha önce kullanılmış.',
  CONFLICT: '',
  NOT_FOUND: 'Bulunamadı. Sayfayı yenile.',
  NETWORK: 'Sunucuya ulaşılamadı. API çalışıyor mu?',
};

export function adminErrorMessage(e: unknown): string {
  const code = e instanceof ApiRequestError ? e.code : 'NETWORK';
  // CONFLICT ve INVALID_CREDENTIALS gibi duruma göre değişen hatalarda sunucunun güvenli mesajı gösterilir.
  if (
    e instanceof ApiRequestError &&
    (code === 'CONFLICT' || code === 'VALIDATION_FAILED' || code === 'INVALID_CREDENTIALS')
  )
    return e.message;
  return MESSAGES[code] || (e instanceof ApiRequestError ? e.message : 'Beklenmeyen bir hata oluştu.');
}

export function isExpiredStep(e: unknown): boolean {
  return e instanceof ApiRequestError && e.code === 'UNAUTHENTICATED';
}
