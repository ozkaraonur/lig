import {
  computeStreak,
  daysToNextMilestone,
  JOKER_DURATION_DAYS,
  STREAK_MILESTONE_DAYS,
  STREAK_MILESTONE_XP,
  type StreakState,
  type StreakView,
  trDate,
} from '@lig/shared';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { grantXp, type DbExecutor } from '../xp/xp-ledger';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Oyuncunun etkin günleri: ziyaret günleri ile emir günleri. Her sorgu oyuncu ve tenant ile sınırlı (NFR-03). */
async function activeDays(db: DbExecutor, tenantId: string, playerId: string): Promise<string[]> {
  const result = await db.execute<{ day: string }>(sql`
    select day::text as day from player_activity_days
    where player_id = ${playerId}::uuid and tenant_id = ${tenantId}::uuid
    union
    select ((o.created_at at time zone 'UTC') + interval '3 hours')::date::text as day
    from virtual_orders o
    join memberships m on m.id = o.membership_id
    join leagues l on l.id = m.league_id
    where m.player_id = ${playerId}::uuid and l.tenant_id = ${tenantId}::uuid
  `);
  return result.rows.map((r) => r.day);
}

/** Bugünü ziyaret günü olarak yazar. Aynı gün ikinci çağrı satır eklemez (birincil anahtar). */
export async function recordVisit(db: DbExecutor, tenantId: string, playerId: string, now: Date) {
  await db.execute(sql`
    insert into player_activity_days (player_id, tenant_id, day)
    select p.id, p.tenant_id, ${trDate(now)}::date from players p
    where p.id = ${playerId}::uuid and p.tenant_id = ${tenantId}::uuid
    on conflict do nothing
  `);
}

export function milestoneSource(state: StreakState, milestone: number): string {
  return `${state.startDate}:${milestone * STREAK_MILESTONE_DAYS}`;
}

/**
 * Seri eşiklerinin ödüllerini verir: her 7 etkin günde XP ve bir joker. Ödüller kaynak veriden (etkin
 * günler) hesaplanır; (oyuncu, sebep, kaynak) ve (oyuncu, kaynak) tekilliği yüzünden tekrar ya da eşzamanlı
 * çağrı ikinci ödül vermez. Yeni verilen XP'yi döner.
 */
export async function awardStreak(db: DbExecutor, tenantId: string, playerId: string, now: Date) {
  const state = computeStreak(await activeDays(db, tenantId, playerId), trDate(now));
  let xp = 0;
  for (let k = 1; k <= state.milestones; k += 1) {
    const source = milestoneSource(state, k);
    xp += await grantXp(db, [{ playerId, reason: 'streak', sourceId: source, amount: STREAK_MILESTONE_XP }]);
    // Hedefsiz ON CONFLICT: tekillik kalkarsa test çift joker görür (mutasyon kanıtı).
    await db.execute(sql`
      insert into xp_jokers (tenant_id, player_id, source_id)
      values (${tenantId}::uuid, ${playerId}::uuid, ${source})
      on conflict do nothing
    `);
  }
  return { state, xp };
}

export async function streakView(
  db: DbExecutor,
  tenantId: string,
  playerId: string,
  now: Date,
): Promise<StreakView> {
  const state = computeStreak(await activeDays(db, tenantId, playerId), trDate(now));
  const jokers = await db.execute<{ available: number; active_until: Date | string | null }>(sql`
    select count(*) filter (where activated_at is null)::int as available,
           max(expires_at) filter (where expires_at > ${now.toISOString()}::timestamptz) as active_until
    from xp_jokers where player_id = ${playerId}::uuid and tenant_id = ${tenantId}::uuid
  `);
  const row = jokers.rows[0];
  return {
    days: state.days,
    activeToday: state.activeToday,
    atRisk: state.atRisk,
    daysToMilestone: daysToNextMilestone(state.days),
    milestoneXp: STREAK_MILESTONE_XP,
    joker: {
      available: Number(row?.available ?? 0),
      activeUntil: row?.active_until ? new Date(row.active_until).toISOString() : null,
    },
  };
}

/**
 * Bir jokeri etkinleştirir. Oyuncu satırı kilitlenir: aynı oyuncunun iki eşzamanlı etkinleştirmesi sıraya
 * girer ve ikincisi birincinin etkin jokerini görür. Kilit olmadan ikisi de "etkin joker yok" der ve süreler
 * üst üste biner.
 */
export async function activateJoker(db: DbExecutor, tenantId: string, playerId: string, now: Date) {
  const locked = await db.execute(sql`
    select 1 from players where id = ${playerId}::uuid and tenant_id = ${tenantId}::uuid for update
  `);
  if (locked.rows.length === 0) throw new AppError('NOT_FOUND', 404, 'Oyuncu bulunamadı.');

  const active = await db.execute(sql`
    select 1 from xp_jokers
    where player_id = ${playerId}::uuid and expires_at > ${now.toISOString()}::timestamptz
  `);
  if (active.rows.length > 0) throw new AppError('CONFLICT', 409, 'Zaten etkin bir XP jokerin var.');

  const expires = new Date(now.getTime() + JOKER_DURATION_DAYS * DAY_MS);
  const updated = await db.execute(sql`
    update xp_jokers set activated_at = ${now.toISOString()}::timestamptz,
                         expires_at = ${expires.toISOString()}::timestamptz
    where id = (
      select id from xp_jokers
      where player_id = ${playerId}::uuid and tenant_id = ${tenantId}::uuid and activated_at is null
      order by earned_at, id limit 1
    )
    returning id
  `);
  if (updated.rows.length === 0) throw new AppError('CONFLICT', 409, 'Kullanabileceğin XP jokerin yok.');
}

/** Verilen anda etkin joker var mı. Görev XP'sinin 2 kat olup olmayacağına bakar. */
export async function jokerActiveAt(db: DbExecutor, tenantId: string, playerId: string, at: Date) {
  const result = await db.execute(sql`
    select 1 from xp_jokers
    where player_id = ${playerId}::uuid and tenant_id = ${tenantId}::uuid
      and activated_at <= ${at.toISOString()}::timestamptz and ${at.toISOString()}::timestamptz < expires_at
    limit 1
  `);
  return result.rows.length > 0;
}
