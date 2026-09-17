import { Inject, Injectable } from '@nestjs/common';
import { questTitle, type QuestView, questWindow } from '@lig/shared';
import { DB, type Database } from '../db/db.module';
import { type DbExecutor, grantXp } from '../xp/xp-ledger';
import { type QuestRecord, questStore } from './quest-store';

/** XP defterindeki kaynak kimliği: görev + dönem. Haftalık görev her hafta ayrı ödüllenir. */
export const questSourceId = (questId: string, periodKey: string) => `${questId}:${periodKey}`;

/**
 * Bir oyuncunun görevlerini belirli bir ana göre değerlendirir (FR-07): ilerlemeyi kaynak veriden sayar,
 * kaydeder, hedefe ulaşılan görevin XP'sini verir. Tekrar çalıştırmak güvenlidir: sayım aynı sonucu verir,
 * XP defteri aynı görev-dönem için ikinci ödülü reddeder.
 */
export async function evaluatePlayerQuests(
  db: DbExecutor,
  tenantId: string,
  playerId: string,
  at: Date,
): Promise<{ completed: string[]; xpGranted: number }> {
  const active = await questStore.listActive(db, tenantId);
  const completed: string[] = [];
  let xpGranted = 0;

  for (const quest of active) {
    const window = questWindow(quest.period, at);
    const count = await questStore.count(db, quest.template, tenantId, playerId, window);
    const progress = Math.min(count, quest.targetCount);
    const done = progress >= quest.targetCount;
    await questStore.saveProgress(db, playerId, quest.id, window.key, progress, done, at);
    if (done) {
      const granted = await grantXp(db, [
        { playerId, reason: 'quest', sourceId: questSourceId(quest.id, window.key), amount: quest.xpReward },
      ]);
      if (granted > 0) completed.push(quest.id);
      xpGranted += granted;
    }
  }
  return { completed, xpGranted };
}

@Injectable()
export class QuestsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Oyuncunun güncel dönemdeki görevleri. İlerleme anlık sayılır (görev worker'ının birkaç saniyelik
   * gecikmesini beklemez); "tamamlandı" ve XP ise yalnızca worker'ın yazdığı kayıttan gelir.
   */
  async listForPlayer(tenantId: string, playerId: string, now: Date): Promise<QuestView[]> {
    const active = await questStore.listActive(this.db, tenantId);
    const windows = new Map(active.map((q) => [q.id, questWindow(q.period, now)]));
    const stored = await questStore.progressFor(
      this.db,
      playerId,
      active.map((q) => q.id),
      [...new Set([...windows.values()].map((w) => w.key))],
    );

    return Promise.all(
      active.map(async (quest: QuestRecord): Promise<QuestView> => {
        const window = windows.get(quest.id)!;
        const saved = stored.find((s) => s.questId === quest.id && s.periodKey === window.key);
        const live = await questStore.count(this.db, quest.template, tenantId, playerId, window);
        const progress = Math.min(Math.max(live, saved?.progress ?? 0), quest.targetCount);
        return {
          id: quest.id,
          template: quest.template,
          period: quest.period,
          title: questTitle(quest.template, quest.targetCount, quest.period),
          target: quest.targetCount,
          progress,
          xpReward: quest.xpReward,
          completed: Boolean(saved?.completedAt),
          completedAt: saved?.completedAt?.toISOString() ?? null,
          resetsAt: window.end?.toISOString() ?? null,
        };
      }),
    );
  }
}
