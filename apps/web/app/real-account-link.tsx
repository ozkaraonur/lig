'use client';

import { type PublicPlatform } from '@lig/shared';

/**
 * FR-08: oyuncuyu platformun kendi işlem ekranına götürür. Adres sunucuda http(s) olarak doğrulanır;
 * burada da tekrar kontrol edilir (savunma katmanı), "javascript:" gibi bir adres asla bağlantı olmaz.
 */
export function RealAccountLink({ platform }: { platform: PublicPlatform }) {
  const url = platform.realTradeUrl;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return (
    <a className="real-account" href={url} rel="noopener noreferrer">
      Gerçek hesabıma geç · {platform.name}
    </a>
  );
}
