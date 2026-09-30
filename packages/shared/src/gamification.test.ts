import { describe, expect, it } from 'vitest';
import {
  appearanceRequest,
  BADGE_IDS,
  BADGES,
  FRAMES,
  highestTitle,
  resolveTitle,
  TITLES,
} from './gamification';

describe('katalog tutarlılığı', () => {
  it('kimlikler tekildir', () => {
    for (const list of [BADGES, FRAMES, TITLES]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('her çerçeve var olan bir rozete bağlıdır ve her rozetin bir çerçevesi vardır', () => {
    for (const frame of FRAMES) expect(BADGE_IDS).toContain(frame.badgeId);
    for (const id of BADGE_IDS) expect(FRAMES.some((f) => f.badgeId === id)).toBe(true);
  });

  it('unvan eşikleri sıfırdan başlar ve artar', () => {
    expect(TITLES[0].minXp).toBe(0);
    for (let i = 1; i < TITLES.length; i += 1) {
      expect(TITLES[i]!.minXp).toBeGreaterThan(TITLES[i - 1]!.minXp);
    }
  });

  it('ilk rozet setinde Faz 4 rozetleri yok', () => {
    const names = BADGES.map((b) => b.name);
    expect(names).toContain('Tavan Avcısı');
    expect(names).not.toContain('Temettü Emeklisi');
    expect(names).not.toContain('Açığa Satış Üstadı');
  });
});

describe('unvan', () => {
  it('XP eşiğine göre en yüksek unvan seçilir', () => {
    expect(highestTitle(0).id).toBe('rookie');
    expect(highestTitle(99).id).toBe('rookie');
    expect(highestTitle(100).id).toBe('novice');
    expect(highestTitle(1_499).id).toBe('experienced');
    expect(highestTitle(1_000_000).id).toBe('market_wolf');
  });

  it('seçim sahip olunan unvansa görünür', () => {
    expect(resolveTitle(600, 'novice').id).toBe('novice');
  });

  it('sahip olunmayan ya da bilinmeyen seçim en yüksek unvana düşer', () => {
    expect(resolveTitle(50, 'market_wolf').id).toBe('rookie');
    expect(resolveTitle(600, 'yok').id).toBe('experienced');
    expect(resolveTitle(600, null).id).toBe('experienced');
  });
});

describe('appearanceRequest', () => {
  it('kısmi ve null seçimi kabul eder', () => {
    expect(appearanceRequest.safeParse({ frame: 'laurel' }).success).toBe(true);
    expect(appearanceRequest.safeParse({ title: null, frame: null }).success).toBe(true);
  });

  it('boş gövdeyi, bilinmeyen kimliği ve fazladan alanı reddeder', () => {
    expect(appearanceRequest.safeParse({}).success).toBe(false);
    expect(appearanceRequest.safeParse({ frame: 'altin' }).success).toBe(false);
    expect(appearanceRequest.safeParse({ frame: 'laurel', xp: 999 }).success).toBe(false);
  });
});
