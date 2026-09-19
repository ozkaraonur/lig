import { z } from 'zod';

/** Marka ayarları (FR-22). Oyuncu ekranının rengi, logosu, platform adı ve tema modu. */
export const DEFAULT_PRIMARY_COLOR = '#c6f24e';

/** Tema modu: koyu (kripto borsası gibi) ya da açık (aracı kurum gibi). */
export const THEME_MODES = ['dark', 'light'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export const DEFAULT_THEME_MODE: ThemeMode = 'dark';

/** Oyuncu ekranının zemin rengi (globals.css `--bg`). Kontrast hesabı buna göre yapılır. */
export const PAGE_BACKGROUNDS: Record<ThemeMode, string> = {
  dark: '#0d0f14',
  light: '#f7f8fa',
};

export const brandColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Renk #RRGGBB biçiminde olmalı')
  .transform((v) => v.toLowerCase());

/**
 * Logo adresi yalnızca https. `javascript:` ya da `data:` adresleri kabul edilmez; oyuncu ekranına
 * gömülen bir adres olduğu için bu kontrol sunucuda yapılır.
 */
export const brandLogoUrl = z
  .string()
  .trim()
  .max(500)
  .pipe(z.url())
  .refine((v) => v.startsWith('https://'), 'Logo adresi https ile başlamalı');

export const platformDisplayName = z
  .string()
  .trim()
  .min(2, 'Ad en az 2 karakter olmalı')
  .max(40, 'Ad en fazla 40 karakter olabilir')
  .regex(/^[^\p{Cc}<>]+$/u, 'Ad geçersiz karakter içeriyor');

/** PATCH /admin/branding. Gönderilmeyen alan değişmez; `logoUrl: null` logoyu kaldırır. */
export const brandingUpdateRequest = z
  .strictObject({
    name: platformDisplayName,
    primaryColor: brandColor,
    logoUrl: brandLogoUrl.nullable(),
    themeMode: z.enum(THEME_MODES),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'En az bir alan değişmeli');
export type BrandingUpdateRequest = z.infer<typeof brandingUpdateRequest>;

export interface BrandingView {
  name: string;
  primaryColor: string;
  logoUrl: string | null;
  themeMode: ThemeMode;
}

/** Oyuncuya giden marka bilgisi. */
export interface PublicBranding {
  primaryColor: string;
  logoUrl: string | null;
  themeMode: ThemeMode;
}

/**
 * Seçilen rengin üstünde okunabilir yazı rengi. WCAG'ın göreli parlaklık formülü: koyu renklerde beyaz,
 * açık renklerde koyu yazı. Yönetici okunmaz bir kombinasyon seçemesin diye renk arayüzde seçilmez, hesaplanır.
 */
export function readableTextColor(hex: string): '#ffffff' | '#12151c' {
  return relativeLuminance(rgb(hex)) > 0.35 ? '#12151c' : '#ffffff';
}

/** Koyu temanın zemini; geriye dönük ad. */
export const PAGE_BACKGROUND = PAGE_BACKGROUNDS.dark;

/** WCAG AA: normal boyutlu yazı için en az 4.5:1. */
const MIN_CONTRAST = 4.5;

/**
 * Marka renginin koyu zemin üstünde yazı olarak kullanılabilen tonu. Marka rengi koyu seçildiğinde
 * (ör. lacivert) link, XP ve rozet yazıları zeminle karışır; renk okunur kontrasta ulaşana kadar
 * beyaza doğru açılır. Zaten yeterliyse renk aynen döner, yani varsayılan tema değişmez.
 */
export function accentTextColor(hex: string, mode: ThemeMode = DEFAULT_THEME_MODE): string {
  const base = rgb(hex);
  const backgroundHex = PAGE_BACKGROUNDS[mode];
  const background = relativeLuminance(rgb(backgroundHex));
  // Koyu zeminde renk beyaza, açık zeminde siyaha doğru karıştırılarak okunur hale getirilir.
  const target = mode === 'light' ? 0 : 255;
  for (let step = 0; step <= 20; step += 1) {
    const mixed = base.map((c) => Math.round(c + (target - c) * (step / 20))) as [number, number, number];
    if (contrast(relativeLuminance(mixed), background) >= MIN_CONTRAST) return toHex(mixed);
  }
  return mode === 'light' ? '#000000' : '#ffffff';
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function toHex(channels: [number, number, number]): string {
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: number, b: number): number {
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  dark: 'Koyu',
  light: 'Açık',
};
