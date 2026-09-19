'use client';

import { MARKET_PHASE_LABELS, type MarketStatus } from '@lig/shared';

/**
 * Seans kapalıyken oyuncuya durumu ve bir sonraki açılışı gösterir (Faz 2, 7. adım). Saat sunucudan
 * gelir; oyuncunun telefonu yanlış saatte olsa da ekranda doğru bilgi durur.
 */
export function MarketNotice({ market }: { market: MarketStatus }) {
  if (market.open) return null;
  const opensAt = market.opensAt
    ? new Date(market.opensAt).toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  return (
    <p className="card notice" role="status">
      <strong>{MARKET_PHASE_LABELS[market.phase]}</strong>
      <span className="muted">
        Hisse emirleri yalnızca seans saatinde verilir. Fiyatlar son kapanışta duruyor
        {opensAt ? `; seans ${opensAt} açılıyor` : ''}.
      </span>
    </p>
  );
}
