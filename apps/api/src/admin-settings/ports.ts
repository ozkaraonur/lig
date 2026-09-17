import { type BrandingView, type QuestPeriod, type QuestTemplate } from '@lig/shared';
import { type AuditEntry } from '../audit/audit-log';

export interface AdminQuestRecord {
  id: string;
  template: QuestTemplate;
  period: QuestPeriod;
  targetCount: number;
  xpReward: number;
  active: boolean;
  createdAt: Date;
  /** Bu görevden XP kazanan oyuncu sayısı (xp_ledger'dan). */
  completions: number;
}

export interface NewQuest {
  tenantId: string;
  template: QuestTemplate;
  period: QuestPeriod;
  targetCount: number;
  xpReward: number;
  active: boolean;
}

export type QuestPatch = Partial<Pick<NewQuest, 'targetCount' | 'xpReward' | 'active'>>;

export type CreateQuestResult =
  | { kind: 'created'; quest: AdminQuestRecord }
  /** Aynı şablon ve dönemde görev zaten var. */
  | { kind: 'duplicate' };

export interface AdminQuestRepository {
  list(tenantId: string): Promise<AdminQuestRecord[]>;
  create(quest: NewQuest, audit: (created: AdminQuestRecord) => AuditEntry): Promise<CreateQuestResult>;
  /** `plan` kilitli kayıtla çağrılır; kural ihlalinde fırlatır. Lig yoksa null. */
  update(
    tenantId: string,
    questId: string,
    plan: (current: AdminQuestRecord) => { patch: QuestPatch; audit: AuditEntry | null },
  ): Promise<AdminQuestRecord | null>;
  /** XP dağıtmış görev silinmez; `false` döner. Bulunamazsa null. */
  remove(
    tenantId: string,
    questId: string,
    audit: (current: AdminQuestRecord) => AuditEntry,
  ): Promise<boolean | null>;
}

export interface BrandingRepository {
  get(tenantId: string): Promise<BrandingView | null>;
  update(
    tenantId: string,
    changes: Partial<BrandingView>,
    audit: (before: BrandingView, after: BrandingView) => AuditEntry | null,
  ): Promise<BrandingView | null>;
}

export const ADMIN_QUEST_REPOSITORY = Symbol('ADMIN_QUEST_REPOSITORY');
export const BRANDING_REPOSITORY = Symbol('BRANDING_REPOSITORY');
