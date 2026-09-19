import { describe, expect, it } from 'vitest';
import {
  accentTextColor,
  brandingUpdateRequest,
  PAGE_BACKGROUND,
  PAGE_BACKGROUNDS,
  readableTextColor,
} from './branding';

/** WCAG kontrast oranı; testte beklentiyi bağımsız hesaplamak için. */
function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const channel = (start: number) => {
      const v = parseInt(hex.slice(start, start + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const first = luminance(a);
  const second = luminance(b);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

describe('brandingUpdateRequest', () => {
  it('renk #RRGGBB olmalı', () => {
    expect(brandingUpdateRequest.safeParse({ primaryColor: '#1d3f8f' }).success).toBe(true);
    expect(brandingUpdateRequest.safeParse({ primaryColor: 'mavi' }).success).toBe(false);
    expect(brandingUpdateRequest.safeParse({ primaryColor: '#abc' }).success).toBe(false);
  });

  it('renk küçük harfe çevrilir', () => {
    const parsed = brandingUpdateRequest.parse({ primaryColor: '#1D3F8F' });
    expect(parsed.primaryColor).toBe('#1d3f8f');
  });

  it('logo yalnızca https, null ile kaldırılır', () => {
    expect(brandingUpdateRequest.safeParse({ logoUrl: 'https://cdn.test/logo.png' }).success).toBe(true);
    expect(brandingUpdateRequest.safeParse({ logoUrl: null }).success).toBe(true);
    expect(brandingUpdateRequest.safeParse({ logoUrl: 'http://cdn.test/logo.png' }).success).toBe(false);
    expect(brandingUpdateRequest.safeParse({ logoUrl: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('ad HTML ve kontrol karakteri kabul etmez, boş gövde reddedilir', () => {
    expect(brandingUpdateRequest.safeParse({ name: '<b>Borsa</b>' }).success).toBe(false);
    expect(brandingUpdateRequest.safeParse({ name: 'A' }).success).toBe(false);
    expect(brandingUpdateRequest.safeParse({}).success).toBe(false);
  });
});

describe('readableTextColor', () => {
  it('koyu renkte beyaz, açık renkte koyu yazı verir', () => {
    expect(readableTextColor('#1d3f8f')).toBe('#ffffff');
    expect(readableTextColor('#c6f24e')).toBe('#12151c');
  });
});

describe('accentTextColor', () => {
  it('yeterince açık rengi değiştirmez', () => {
    expect(accentTextColor('#c6f24e')).toBe('#c6f24e');
  });

  it('koyu marka rengini zeminde okunur hale getirir', () => {
    const raw = '#1d3f8f';
    expect(contrastRatio(raw, PAGE_BACKGROUND)).toBeLessThan(4.5);
    const adjusted = accentTextColor(raw);
    expect(adjusted).not.toBe(raw);
    expect(contrastRatio(adjusted, PAGE_BACKGROUND)).toBeGreaterThanOrEqual(4.5);
  });

  it('en koyu renkte bile okunur bir ton döner', () => {
    for (const hex of ['#000000', '#0d0f14', '#1a1a1a', '#3b0764']) {
      expect(contrastRatio(accentTextColor(hex), PAGE_BACKGROUND)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('her zaman geçerli #RRGGBB döner', () => {
    expect(accentTextColor('#1d3f8f')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('tema modu', () => {
  it('şemaya yalnızca bilinen modlar girer', () => {
    expect(brandingUpdateRequest.safeParse({ themeMode: 'light' }).success).toBe(true);
    expect(brandingUpdateRequest.safeParse({ themeMode: 'dark' }).success).toBe(true);
    expect(brandingUpdateRequest.safeParse({ themeMode: 'sepia' }).success).toBe(false);
  });

  it('açık temada renk koyulaştırılarak okunur hale gelir', () => {
    // Varsayılan fıstık yeşili beyaz zeminde okunmaz; açık temada koyulaşmalı.
    const light = accentTextColor('#c6f24e', 'light');
    expect(light).not.toBe('#c6f24e');
    expect(contrastRatio(light, PAGE_BACKGROUNDS.light)).toBeGreaterThanOrEqual(4.5);
    // Koyu temada aynı renk olduğu gibi kalır.
    expect(accentTextColor('#c6f24e', 'dark')).toBe('#c6f24e');
  });

  it('koyu renk açık temada olduğu gibi kalır', () => {
    expect(accentTextColor('#1d3f8f', 'light')).toBe('#1d3f8f');
    expect(contrastRatio('#1d3f8f', PAGE_BACKGROUNDS.light)).toBeGreaterThanOrEqual(4.5);
  });

  it('her iki temada da en uç renklerde okunur bir ton döner', () => {
    for (const hex of ['#ffffff', '#000000', '#808080', '#f7f8fa']) {
      expect(contrastRatio(accentTextColor(hex, 'light'), PAGE_BACKGROUNDS.light)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(accentTextColor(hex, 'dark'), PAGE_BACKGROUND)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
