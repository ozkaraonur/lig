import {
  type BadgeId,
  DIVERSE_PORTFOLIO_ASSETS,
  PODIUM_MAX_RANK,
  QUEST_HUNTER_QUESTS,
  TIER_LEAGUE,
} from '@lig/shared';
import { sql } from 'drizzle-orm';
import { type DbExecutor } from '../xp/xp-ledger';

/**
 * Oyuncunun kazandığı rozetleri kaynak veriden hesaplar ve yeni olanları yazar (FR-10, K-030). Olay sayacı
 * tutulmaz: aynı sinyal iki kez işlense de sonuç değişmez. Rozet geri alınmaz; kaynak veri sonradan silinse
 * bile kazanılan rozet kalır.
 *
 * Tekillik `player_badges (player_id, badge_id)` birincil anahtarındadır. `ON CONFLICT DO NOTHING` hedefsiz
 * yazılır: iki worker aynı oyuncuyu aynı anda değerlendirse bile ikinci ekleme sessizce atlanır, kısıt
 * kalkarsa test çift kayıt görür (mutasyon kanıtı). Yeni kazanılan rozetlerin kimliklerini döner.
 *
 * Arkadaş ligleri (`type = 'friends'`) "Lig Bitirici" ve "Podyum" saymaz: iki kişilik bir ligde podyum
 * garantidir ve rozet çiftliğine döner (K-030).
 *
 * Her koşul oyuncu ve tenant ile sınırlıdır (NFR-03); tablo adları açık yazılır (K-008). Seans günü Türkiye
 * takvimiyle (UTC+3) hesaplanır, market-close servisinin yazdığı gün ile aynı tanım.
 */
export async function awardBadges(
  db: DbExecutor,
  tenantId: string,
  playerId: string,
  now: Date,
): Promise<BadgeId[]> {
  const result = await db.execute<{ badge_id: BadgeId }>(sql`
    insert into player_badges (player_id, badge_id, earned_at)
    select ${playerId}::uuid, earned.badge_id, ${now.toISOString()}::timestamptz
    from (
      select 'first_order'::text as badge_id
      where exists (
        select 1 from virtual_orders o
        join memberships m on m.id = o.membership_id
        join leagues l on l.id = m.league_id
        where m.player_id = ${playerId}::uuid and l.tenant_id = ${tenantId}::uuid
      )
      union all
      select 'diverse_portfolio'::text
      where exists (
        select 1 from virtual_orders o
        join memberships m on m.id = o.membership_id
        join leagues l on l.id = m.league_id
        where m.player_id = ${playerId}::uuid and l.tenant_id = ${tenantId}::uuid and o.side = 'buy'
        group by m.id
        having count(distinct o.asset_id) >= ${DIVERSE_PORTFOLIO_ASSETS}::int
      )
      union all
      select 'quest_hunter'::text
      where (
        select count(*) from quest_progress qp
        join quests q on q.id = qp.quest_id
        where qp.player_id = ${playerId}::uuid and q.tenant_id = ${tenantId}::uuid
          and qp.completed_at is not null
      ) >= ${QUEST_HUNTER_QUESTS}::int
      union all
      select 'league_finisher'::text
      where exists (
        select 1 from memberships m
        join leagues l on l.id = m.league_id
        where m.player_id = ${playerId}::uuid and l.tenant_id = ${tenantId}::uuid
          and l.status = 'finished' and l.type <> 'friends' and m.final_rank is not null
          and exists (select 1 from virtual_orders o where o.membership_id = m.id)
      )
      union all
      select 'podium'::text
      where exists (
        select 1 from memberships m
        join leagues l on l.id = m.league_id
        where m.player_id = ${playerId}::uuid and l.tenant_id = ${tenantId}::uuid
          and l.status = 'finished' and l.type <> 'friends' and m.final_rank <= ${PODIUM_MAX_RANK}::int
          and exists (select 1 from virtual_orders o where o.membership_id = m.id)
          -- Kademe grubunda podyum için yeterli sayıda oyuncu emir vermiş olmalı (K-034).
          and (l.type <> 'tier' or (
            select count(*) from memberships m2
            where m2.league_id = l.id and exists (select 1 from virtual_orders o2 where o2.membership_id = m2.id)
          ) >= ${TIER_LEAGUE.minParticipants}::int)
      )
      union all
      select 'limit_up_hunter'::text
      where exists (
        select 1 from virtual_orders o
        join memberships m on m.id = o.membership_id
        join leagues l on l.id = m.league_id
        join asset_limit_days d on d.asset_id = o.asset_id
          and d.session_date = ((o.created_at at time zone 'UTC') + interval '3 hours')::date
        where m.player_id = ${playerId}::uuid and l.tenant_id = ${tenantId}::uuid
          and d.tenant_id = ${tenantId}::uuid and d.kind = 'limit_up' and o.side = 'buy'
      )
    ) as earned
    on conflict do nothing
    returning badge_id
  `);
  return result.rows.map((r) => r.badge_id);
}
