import { z } from 'zod';
import { QUEST_PERIODS, QUEST_TEMPLATES, type QuestPeriod, type QuestTemplate } from './quests';

/**
 * Bir platformda aynı anda tanımlı olabilecek görev sayısı: her şablon her dönemde bir kez (K-023).
 * Sayı ayrı bir sınır olarak kontrol edilmez, `(tenant_id, template, period)` tekil indeksinden doğar.
 */
export const MAX_QUESTS_PER_TENANT = QUEST_TEMPLATES.length * QUEST_PERIODS.length;

export const QUEST_LIMITS = { targetMin: 1, targetMax: 1000, xpMin: 1, xpMax: 100_000 };

const targetCount = z.number().int().min(QUEST_LIMITS.targetMin).max(QUEST_LIMITS.targetMax);
/** Ödül yalnızca XP; para birimi ya da nakit karşılığı alanı yoktur (FR-24, NFR-06). */
const xpReward = z.number().int().min(QUEST_LIMITS.xpMin).max(QUEST_LIMITS.xpMax);

/** POST /admin/quests (FR-21). Şablon ve dönem sonradan değişmez: anlamı değişen görev ilerlemeyi bozar. */
export const createQuestRequest = z.strictObject({
  template: z.enum(QUEST_TEMPLATES),
  period: z.enum(QUEST_PERIODS),
  targetCount,
  xpReward,
  active: z.boolean().default(true),
});
export type CreateQuestRequest = z.infer<typeof createQuestRequest>;

export const updateQuestRequest = z
  .strictObject({ targetCount, xpReward, active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'En az bir alan değişmeli');
export type UpdateQuestRequest = z.infer<typeof updateQuestRequest>;

export interface AdminQuestView {
  id: string;
  template: QuestTemplate;
  period: QuestPeriod;
  title: string;
  targetCount: number;
  xpReward: number;
  active: boolean;
  createdAt: string;
  /** Kaç oyuncu bu görevden XP kazandı. */
  completions: number;
  /** Hiç XP dağıtmamış görev silinebilir; dağıtmışsa yalnızca pasife alınır. */
  deletable: boolean;
}

export const QUEST_TEMPLATE_LABELS: Record<QuestTemplate, string> = {
  join_league: 'Lige katıl',
  place_orders: 'Emir ver',
  trade_distinct_assets: 'Farklı varlıklarla işlem yap',
  real_trade: 'Gerçek hesapta işlem yap',
};

export const QUEST_PERIOD_LABELS: Record<QuestPeriod, string> = {
  once: 'Tek seferlik',
  weekly: 'Haftalık',
};
