import { type QuestPeriod, type QuestTemplate, type QuestWindow } from '@lig/shared';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { questProgress, quests, tenants } from '../db/schema';
import { type DbExecutor } from '../xp/xp-ledger';

export interface QuestRecord {
  id: string;
  template: QuestTemplate;
  period: QuestPeriod;
  targetCount: number;
  xpReward: number;
}

export interface StoredProgress {
  questId: string;
  periodKey: string;
  progress: number;
  completedAt: Date | null;
}

/** Görev verisine erişim. Her metod çağıranın verdiği bağlantı ya da transaction üzerinde çalışır. */
export const questStore = {
  async listActive(db: DbExecutor, tenantId: string): Promise<QuestRecord[]> {
    const rows = await db
      .select({
        id: quests.id,
        template: quests.template,
        period: quests.period,
        targetCount: quests.targetCount,
        xpReward: quests.xpReward,
      })
      .from(quests)
      .innerJoin(tenants, eq(tenants.id, quests.tenantId))
      .where(
        and(
          eq(quests.tenantId, tenantId),
          eq(quests.active, true),
          // Uyum ayarı (FR-24): platform "gerçek işlem yap" görevini kapattıysa görev listelenmez, ilerlemez,
          // XP vermez. Açılınca dönem içindeki gerçek işlemler yine sayılır.
          or(ne(quests.template, 'real_trade'), eq(tenants.realTradeQuestEnabled, true)),
        ),
      )
      .orderBy(quests.createdAt, quests.id);
    // Şablon ve dönem veritabanında CHECK kısıtıyla sınırlı; tip daraltma güvenli.
    return rows as QuestRecord[];
  },

  /**
   * Görev ilerlemesini kaynak veriden sayar. Olay sayacı tutulmaz: aynı olay iki kez işlense de sonuç
   * değişmez. Her sorgu oyuncu ve tenant ile sınırlıdır (T4). Tablo adları açık yazılır (K-008).
   */
  async count(
    db: DbExecutor,
    template: QuestTemplate,
    tenantId: string,
    playerId: string,
    window: QuestWindow,
  ): Promise<number> {
    const from = window.start?.toISOString() ?? null;
    const to = window.end?.toISOString() ?? null;
    const inWindow = (column: string) =>
      sql`(${from}::timestamptz is null or ${sql.raw(column)} >= ${from}::timestamptz)
          and (${to}::timestamptz is null or ${sql.raw(column)} < ${to}::timestamptz)`;

    let query;
    switch (template) {
      case 'join_league':
        // Arkadaş ligine katılmak sayılmaz: kodla girmek ve kendi ligini kurmak görev XP'si çiftliğine dönerdi (K-033).
        query = sql`
          select count(*)::int as n from memberships m join leagues l on l.id = m.league_id
          where m.player_id = ${playerId}::uuid and l.tenant_id = ${tenantId}::uuid
            and l.type <> 'friends' and ${inWindow('m.joined_at')}`;
        break;
      case 'place_orders':
        query = sql`
          select count(*)::int as n from virtual_orders o
          join memberships m on m.id = o.membership_id join leagues l on l.id = m.league_id
          where m.player_id = ${playerId}::uuid and l.tenant_id = ${tenantId}::uuid and ${inWindow('o.created_at')}`;
        break;
      case 'trade_distinct_assets':
        query = sql`
          select count(distinct o.asset_id)::int as n from virtual_orders o
          join memberships m on m.id = o.membership_id join leagues l on l.id = m.league_id
          where m.player_id = ${playerId}::uuid and l.tenant_id = ${tenantId}::uuid and ${inWindow('o.created_at')}`;
        break;
      case 'buy_distinct_sectors':
        // Yalnızca alışlar sayılır. Sektörü olmayan (kripto) varlık sayılmaz: count(distinct) null'ı atlar.
        // Varlık da tenant'a bağlı (T4).
        query = sql`
          select count(distinct a.sector)::int as n from virtual_orders o
          join memberships m on m.id = o.membership_id join leagues l on l.id = m.league_id
          join assets a on a.id = o.asset_id
          where m.player_id = ${playerId}::uuid and l.tenant_id = ${tenantId}::uuid and a.tenant_id = ${tenantId}::uuid
            and o.side = 'buy' and ${inWindow('o.created_at')}`;
        break;
      case 'real_trade':
        query = sql`
          select count(*)::int as n from platform_events e
          where e.player_id = ${playerId}::uuid and e.tenant_id = ${tenantId}::uuid
            and e.type = 'real_trade' and ${inWindow('e.occurred_at')}`;
        break;
    }
    const result = await db.execute<{ n: number }>(query);
    return Number(result.rows[0]?.n ?? 0);
  },

  async progressFor(db: DbExecutor, playerId: string, questIds: string[], periodKeys: string[]) {
    if (questIds.length === 0) return [];
    return db
      .select({
        questId: questProgress.questId,
        periodKey: questProgress.periodKey,
        progress: questProgress.progress,
        completedAt: questProgress.completedAt,
      })
      .from(questProgress)
      .where(
        and(
          eq(questProgress.playerId, playerId),
          inArray(questProgress.questId, questIds),
          inArray(questProgress.periodKey, periodKeys),
        ),
      );
  },

  /** İlerlemeyi yazar. Hedefe ulaşıldıysa tamamlanma zamanı bir kez işlenir, sonradan değişmez. */
  async saveProgress(
    db: DbExecutor,
    playerId: string,
    questId: string,
    periodKey: string,
    progress: number,
    completed: boolean,
    now: Date,
  ): Promise<void> {
    await db
      .insert(questProgress)
      .values({ playerId, questId, periodKey, progress, completedAt: completed ? now : null, updatedAt: now })
      .onConflictDoUpdate({
        target: [questProgress.playerId, questProgress.questId, questProgress.periodKey],
        set: {
          // İlerleme geriye gitmez: kaynak veri silinse bile oyuncunun kazandığı görev geri alınmaz.
          progress: sql`greatest(${questProgress.progress}, excluded.progress)`,
          completedAt: sql`coalesce(${questProgress.completedAt}, excluded.completed_at)`,
          updatedAt: now,
        },
      });
  },
};
