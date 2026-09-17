'use client';

import { accentTextColor, type PublicBranding, readableTextColor } from '@lig/shared';
import { useEffect } from 'react';

/**
 * Platformun marka rengini (FR-22) sayfaya uygular. Yazı renkleri renkten hesaplanır, ayrı ayarlanmaz:
 * `--accent-text` rengin üstündeki yazı (buton), `--accent-readable` ise koyu zemin üstünde marka
 * rengiyle yazılan yazı (link, XP, rozet) içindir. Yönetici koyu bir renk seçtiğinde ikisi de okunur kalır.
 */
export function BrandingStyle({ branding }: { branding: PublicBranding }) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent', branding.primaryColor);
    root.style.setProperty('--accent-text', readableTextColor(branding.primaryColor));
    root.style.setProperty('--accent-readable', accentTextColor(branding.primaryColor));
  }, [branding.primaryColor]);
  return null;
}

export function BrandLogo({ platform }: { platform: { name: string; branding: PublicBranding } }) {
  if (!platform.branding.logoUrl) return null;
  // Adres sunucuda yalnızca https olarak doğrulanır; burada yalnızca gösterilir.
  return <img className="brand-logo" src={platform.branding.logoUrl} alt={platform.name} />;
}
