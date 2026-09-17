'use client';

import { type PublicPlatform } from '@lig/shared';
import { type MouseEvent } from 'react';
import { apiFetch } from '../lib/api';

/**
 * FR-08: oyuncuyu platformun kendi işlem ekranına götürür. Adres sunucuda http(s) olarak doğrulanır;
 * burada da tekrar kontrol edilir (savunma katmanı), "javascript:" gibi bir adres asla bağlantı olmaz.
 *
 * Dokunuş FR-23 için sayılır. Sayım isteği beklenmez ve hata verse bile bağlantı açılır: ölçüm oyuncunun
 * yolunu kesmez. Bu yüzden `keepalive`, sayfa geçerken istek iptal edilmesin diye.
 */
export function RealAccountLink({ platform, leagueId }: { platform: PublicPlatform; leagueId?: string }) {
  const url = platform.realTradeUrl;
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const count = (event: MouseEvent<HTMLAnchorElement>) => {
    // Orta tık ya da yeni sekmede açma da sayılır; olayı engellemiyoruz.
    if (event.defaultPrevented) return;
    void apiFetch('/real-trade/click', {
      method: 'POST',
      body: JSON.stringify({ leagueId: leagueId ?? null }),
      keepalive: true,
    }).catch(() => undefined);
  };

  return (
    <a className="real-account" href={url} rel="noopener noreferrer" onClick={count} onAuxClick={count}>
      Gerçek hesabıma geç · {platform.name}
    </a>
  );
}
