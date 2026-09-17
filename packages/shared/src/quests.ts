import { z } from 'zod';

/**
 * Görev şablonları (FR-07). Yönetici panelinden şablon seçilir (FR-21, Faz 2); şimdilik seed ile eklenir.
 * İlerleme her zaman kaynak veriden sayılır (emirler, üyelikler, platform olayları): aynı olay iki kez
 * gelse de görev iki kez ilerlemez.
 */
export const QUEST_TEMPLATES = [
  'join_league',
  'place_orders',
  'trade_distinct_assets',
  'real_trade',
] as const;
export type QuestTemplate = (typeof QUEST_TEMPLATES)[number];

export const QUEST_PERIODS = ['once', 'weekly'] as const;
export type QuestPeriod = (typeof QUEST_PERIODS)[number];

/** Haftalık görevler Türkiye saatine göre pazartesi 00:00'da yenilenir. Türkiye 2016'dan beri sabit UTC+3. */
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface QuestWindow {
  /** Dönem anahtarı: "once" ya da ISO hafta, ör. "2026-W38". */
  key: string;
  start: Date | null;
  end: Date | null;
}

export function questWindow(period: QuestPeriod, now: Date): QuestWindow {
  if (period === 'once') return { key: 'once', start: null, end: null };

  // Türkiye saatindeki takvim gününe göre çalışmak için zamanı +3 saat kaydırıp UTC gibi okuyoruz.
  const local = new Date(now.getTime() + TR_OFFSET_MS);
  const dayOfWeek = (local.getUTCDay() + 6) % 7; // pazartesi = 0
  const mondayLocal =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - dayOfWeek * DAY_MS;
  const start = new Date(mondayLocal - TR_OFFSET_MS);
  const end = new Date(start.getTime() + 7 * DAY_MS);

  // ISO hafta numarası: haftanın yılı, o haftanın perşembesinin yılıdır.
  const thursday = new Date(mondayLocal + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstMonday = firstThursday.getTime() - ((firstThursday.getUTCDay() + 6) % 7) * DAY_MS;
  const week = Math.round((mondayLocal - firstMonday) / (7 * DAY_MS)) + 1;

  return { key: `${isoYear}-W${String(week).padStart(2, '0')}`, start, end };
}

export function questTitle(template: QuestTemplate, target: number, period: QuestPeriod): string {
  const base = baseTitle(template, target);
  if (period === 'once') return base;
  return `Bu hafta ${base.charAt(0).toLocaleLowerCase('tr-TR')}${base.slice(1)}`;
}

function baseTitle(template: QuestTemplate, target: number): string {
  switch (template) {
    case 'join_league':
      return target === 1 ? 'Bir lige katıl' : `${target} lige katıl`;
    case 'place_orders':
      return `${target} emir ver`;
    case 'trade_distinct_assets':
      return `${target} farklı varlıkta işlem yap`;
    case 'real_trade':
      return target === 1 ? 'Platformda gerçek bir işlem yap' : `Platformda ${target} gerçek işlem yap`;
  }
}

export interface QuestView {
  id: string;
  template: QuestTemplate;
  period: QuestPeriod;
  title: string;
  target: number;
  progress: number;
  xpReward: number;
  completed: boolean;
  completedAt: string | null;
  /** Haftalık görevin yenileneceği an; tek seferlik görevde null. */
  resetsAt: string | null;
}

/** Platformun gönderdiği gerçek işlem olayı (FR-31). Oyuncu kimliği platformdaki takma kimliktir. */
export const platformEventWebhook = z.strictObject({
  eventId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9_.:-]+$/),
  type: z.enum(['real_trade', 'account_opened']),
  playerId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.:-]+$/),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type PlatformEventWebhook = z.infer<typeof platformEventWebhook>;

export const WEBHOOK_HEADERS = {
  issuer: 'x-lig-issuer',
  timestamp: 'x-lig-timestamp',
  signature: 'x-lig-signature',
} as const;

/** İmzalı isteğin kabul edildiği en büyük saat farkı (T5). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
