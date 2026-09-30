import { z } from 'zod';

/**
 * Rozet, unvan ve profil çerçevesi kataloğu (FR-10, K-030). Kodda sabittir: veritabanında katalog tablosu yok,
 * yönetici panelinden değişmez. Kazanılanlar yalnızca görünümdür; XP, bakiye ya da sıralama vermez (NFR-06).
 */

/** Rozet kazanma eşikleri. Sayımı `apps/api/src/gamification/badge-store.ts` kaynak veriden yapar. */
export const DIVERSE_PORTFOLIO_ASSETS = 3;
export const QUEST_HUNTER_QUESTS = 5;
export const PODIUM_MAX_RANK = 3;

export interface BadgeDef {
  id: string;
  name: string;
  description: string;
}

export const BADGES = [
  { id: 'first_order', name: 'İlk Emir', description: 'İlk sanal emrini verdin.' },
  {
    id: 'diverse_portfolio',
    name: 'Çeşitli Portföy',
    description: `Aynı ligde ${DIVERSE_PORTFOLIO_ASSETS} farklı varlıktan alış yaptın.`,
  },
  {
    id: 'quest_hunter',
    name: 'Görev Avcısı',
    description: `${QUEST_HUNTER_QUESTS} görevi tamamladın.`,
  },
  {
    id: 'league_finisher',
    name: 'Lig Bitirici',
    description: 'Bir ligi en az bir emir vererek sonuna kadar götürdün.',
  },
  {
    id: 'podium',
    name: 'Podyum',
    description: `Bir ligi ilk ${PODIUM_MAX_RANK} sırada bitirdin.`,
  },
  {
    id: 'limit_up_hunter',
    name: 'Tavan Avcısı',
    description: 'Bir hissenin tavanda kapandığı seansta o hisseden alış yaptın.',
  },
] as const satisfies readonly BadgeDef[];

export type BadgeId = (typeof BADGES)[number]['id'];
export const BADGE_IDS = BADGES.map((b) => b.id) as [BadgeId, ...BadgeId[]];

export interface FrameDef {
  id: string;
  name: string;
  /** Çerçeve bu rozeti kazanan oyuncuya açılır. */
  badgeId: BadgeId;
}

export const FRAMES = [
  { id: 'starter', name: 'Başlangıç', badgeId: 'first_order' },
  { id: 'mosaic', name: 'Mozaik', badgeId: 'diverse_portfolio' },
  { id: 'compass', name: 'Pusula', badgeId: 'quest_hunter' },
  { id: 'finish_line', name: 'Bitiş Çizgisi', badgeId: 'league_finisher' },
  { id: 'laurel', name: 'Defne', badgeId: 'podium' },
  { id: 'limit_up', name: 'Tavan', badgeId: 'limit_up_hunter' },
] as const satisfies readonly FrameDef[];

export type FrameId = (typeof FRAMES)[number]['id'];
export const FRAME_IDS = FRAMES.map((f) => f.id) as [FrameId, ...FrameId[]];

export interface TitleDef {
  id: string;
  name: string;
  /** Unvan bu XP'ye ulaşan oyuncuya açılır. XP hiç düşmediği için kazanılan unvan geri gitmez. */
  minXp: number;
}

/** Unvanlar XP eşiklerinden türetilir, oyuncu satırında saklanmaz; saklanan yalnızca oyuncunun seçimidir. */
export const TITLES = [
  { id: 'rookie', name: 'Çaylak', minXp: 0 },
  { id: 'novice', name: 'Acemi Yatırımcı', minXp: 100 },
  { id: 'experienced', name: 'Deneyimli Yatırımcı', minXp: 500 },
  { id: 'portfolio_master', name: 'Portföy Ustası', minXp: 1500 },
  { id: 'market_wolf', name: 'Piyasa Kurdu', minXp: 4000 },
] as const satisfies readonly TitleDef[];

export type TitleId = (typeof TITLES)[number]['id'];
export const TITLE_IDS = TITLES.map((t) => t.id) as [TitleId, ...TitleId[]];

export function titleById(id: string): (typeof TITLES)[number] | undefined {
  return TITLES.find((t) => t.id === id);
}

export function frameById(id: string): (typeof FRAMES)[number] | undefined {
  return FRAMES.find((f) => f.id === id);
}

/** XP'ye göre kazanılmış en yüksek unvan. */
export function highestTitle(xp: number): (typeof TITLES)[number] {
  let best: (typeof TITLES)[number] = TITLES[0];
  for (const title of TITLES) if (xp >= title.minXp) best = title;
  return best;
}

/**
 * Görünen unvan: oyuncunun seçtiği, hâlâ sahipse. Seçim yoksa ya da geçersizse en yüksek unvan.
 * Sahiplik burada yeniden doğrulanır: veritabanı elle bozulsa bile sıralamada sahip olunmayan unvan görünmez.
 */
export function resolveTitle(xp: number, selectedId: string | null): (typeof TITLES)[number] {
  const selected = selectedId ? titleById(selectedId) : undefined;
  return selected && xp >= selected.minXp ? selected : highestTitle(xp);
}

export interface BadgeView {
  id: BadgeId;
  name: string;
  description: string;
  earned: boolean;
  earnedAt: string | null;
}

export interface TitleView {
  id: TitleId;
  name: string;
  minXp: number;
  owned: boolean;
  /** Şu an görünen unvan. */
  selected: boolean;
}

export interface FrameView {
  id: FrameId;
  name: string;
  badgeId: BadgeId;
  owned: boolean;
  selected: boolean;
}

export interface ProfileView {
  xp: number;
  badges: BadgeView[];
  titles: TitleView[];
  frames: FrameView[];
}

/**
 * PUT /profile/appearance gövdesi. Verilmeyen alan değişmez; `null` seçimi kaldırır (unvan en yüksek
 * unvana döner, çerçeve kalkar). Fazladan alan reddedilir.
 */
export const appearanceRequest = z
  .strictObject({
    title: z.enum(TITLE_IDS).nullable().optional(),
    frame: z.enum(FRAME_IDS).nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.frame !== undefined, { message: 'Bir alan gerekli' });
export type AppearanceRequest = z.infer<typeof appearanceRequest>;
