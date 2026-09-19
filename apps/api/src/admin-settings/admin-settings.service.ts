import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminQuestView,
  type BrandingUpdateRequest,
  type BrandingView,
  type CreateQuestRequest,
  questTitle,
  type UpdateQuestRequest,
} from '@lig/shared';
import { adminActor } from '../admin-auth/admin-auth.service';
import { type AdminAccount } from '../admin-auth/ports';
import { type AuditMetadata } from '../audit/audit-log';
import { AppError } from '../common/app-error';
import { CLOCK_MS, type MsClock } from '../common/clock';
import {
  ADMIN_QUEST_REPOSITORY,
  type AdminQuestRecord,
  type AdminQuestRepository,
  BRANDING_REPOSITORY,
  type BrandingRepository,
  type QuestPatch,
} from './ports';

const questNotFound = () => new AppError('NOT_FOUND', 404, 'Görev bulunamadı.');

export function toQuestView(quest: AdminQuestRecord): AdminQuestView {
  return {
    id: quest.id,
    template: quest.template,
    period: quest.period,
    title: questTitle(quest.template, quest.targetCount, quest.period),
    targetCount: quest.targetCount,
    xpReward: quest.xpReward,
    active: quest.active,
    createdAt: quest.createdAt.toISOString(),
    completions: quest.completions,
    deletable: quest.completions === 0,
  };
}

/** Görev şablonları (FR-21) ve marka ayarları (FR-22). Sahip ve düzenleyici değiştirir, izleyici görür. */
@Injectable()
export class AdminSettingsService {
  constructor(
    @Inject(ADMIN_QUEST_REPOSITORY) private readonly quests: AdminQuestRepository,
    @Inject(BRANDING_REPOSITORY) private readonly branding: BrandingRepository,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  async listQuests(admin: AdminAccount): Promise<AdminQuestView[]> {
    return (await this.quests.list(admin.tenantId)).map(toQuestView);
  }

  async createQuest(admin: AdminAccount, input: CreateQuestRequest, ip: string): Promise<AdminQuestView> {
    const now = new Date(this.clock());
    const result = await this.quests.create({ tenantId: admin.tenantId, ...input }, (created) => ({
      tenantId: admin.tenantId,
      action: 'quest.created',
      actor: adminActor(admin),
      target: {
        type: 'quest',
        id: created.id,
        label: questTitle(created.template, created.targetCount, created.period),
      },
      ip,
      metadata: {
        template: created.template,
        period: created.period,
        targetCount: created.targetCount,
        xpReward: created.xpReward,
        active: created.active,
      },
      occurredAt: now,
    }));
    if (result.kind === 'duplicate') {
      throw new AppError(
        'CONFLICT',
        409,
        'Bu şablon ve dönem için zaten bir görev var. Mevcut görevi düzenle.',
      );
    }
    return toQuestView(result.quest);
  }

  async updateQuest(
    admin: AdminAccount,
    questId: string,
    input: UpdateQuestRequest,
    ip: string,
  ): Promise<AdminQuestView> {
    const now = new Date(this.clock());
    const updated = await this.quests.update(admin.tenantId, questId, (current) => {
      const patch: QuestPatch = {};
      const meta: AuditMetadata = {};
      for (const field of ['targetCount', 'xpReward', 'active'] as const) {
        const next = input[field];
        if (next === undefined || next === current[field]) continue;
        (patch as Record<string, unknown>)[field] = next;
        meta[`${field}From`] = current[field];
        meta[`${field}To`] = next;
      }
      if (Object.keys(patch).length === 0) return { patch, audit: null };
      return {
        patch,
        audit: {
          tenantId: admin.tenantId,
          action: 'quest.updated',
          actor: adminActor(admin),
          target: {
            type: 'quest',
            id: current.id,
            label: questTitle(current.template, patch.targetCount ?? current.targetCount, current.period),
          },
          ip,
          metadata: { ...meta, template: current.template, period: current.period },
          occurredAt: now,
        },
      };
    });
    if (!updated) throw questNotFound();
    return toQuestView(updated);
  }

  async deleteQuest(admin: AdminAccount, questId: string, ip: string): Promise<void> {
    const now = new Date(this.clock());
    const removed = await this.quests.remove(admin.tenantId, questId, (current) => ({
      tenantId: admin.tenantId,
      action: 'quest.deleted',
      actor: adminActor(admin),
      target: {
        type: 'quest',
        id: current.id,
        label: questTitle(current.template, current.targetCount, current.period),
      },
      ip,
      metadata: { template: current.template, period: current.period, xpReward: current.xpReward },
      occurredAt: now,
    }));
    if (removed === null) throw questNotFound();
    if (!removed) {
      throw new AppError(
        'CONFLICT',
        409,
        'Bu görevden XP kazanan oyuncular var, silinemez. Pasife alabilirsin.',
      );
    }
  }

  async getBranding(admin: AdminAccount): Promise<BrandingView> {
    const branding = await this.branding.get(admin.tenantId);
    if (!branding) throw new AppError('NOT_FOUND', 404, 'Platform bulunamadı.');
    return branding;
  }

  async updateBranding(admin: AdminAccount, input: BrandingUpdateRequest, ip: string): Promise<BrandingView> {
    const now = new Date(this.clock());
    const updated = await this.branding.update(admin.tenantId, input, (before, after) => {
      const meta: AuditMetadata = {};
      for (const key of ['name', 'primaryColor', 'logoUrl', 'themeMode'] as const) {
        if (before[key] !== after[key]) {
          meta[`${key}From`] = before[key];
          meta[`${key}To`] = after[key];
        }
      }
      if (Object.keys(meta).length === 0) return null;
      return {
        tenantId: admin.tenantId,
        action: 'branding.changed',
        actor: adminActor(admin),
        target: { type: 'tenant', id: admin.tenantId, label: after.name },
        ip,
        metadata: meta,
        occurredAt: now,
      };
    });
    if (!updated) throw new AppError('NOT_FOUND', 404, 'Platform bulunamadı.');
    return updated;
  }
}
