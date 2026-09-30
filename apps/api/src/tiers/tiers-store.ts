import { LEAGUE_LIMITS, questWindow, TIER_LEAGUE, type TierId, type TierView, tierName } from '@lig/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { type Database } from '../db/db.module';
import { assets, leagues, memberships } from '../db/schema';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

async function playerTier(db: Executor, tenantId: string, playerId: string): Promise<TierId> {
  const result = await db.execute<{ tier: TierId }>(sql`
    select p.tier from players p where p.id = ${playerId}::uuid and p.tenant_id = ${tenantId}::uuid
  `);
  const row = result.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 404, 'Oyuncu bulunamadı.');
  return row.tier;
}

/** Oyuncunun kademesi, bu haftaki grubu ve son kademe hareketi. Her sorgu oyuncu ve tenant'a bağlı (NFR-03). */
export async function tierView(
  db: Executor,
  tenantId: string,
  playerId: string,
  now: Date,
): Promise<TierView> {
  const tier = await playerTier(db, tenantId, playerId);
  const week = questWindow('weekly', now);

  const current = await db.execute<{ id: string; name: string; tier_group: number }>(sql`
    select l.id, l.name, l.tier_group from leagues l
    join memberships m on m.league_id = l.id
    where m.player_id = ${playerId}::uuid and l.tenant_id = ${tenantId}::uuid
      and l.type = 'tier' and l.starts_at = ${week.start!.toISOString()}::timestamptz
  `);
  const last = await db.execute<{ from_tier: TierId; to_tier: TierId; rank: number }>(sql`
    select h.from_tier, h.to_tier, h.rank from tier_history h
    join players p on p.id = h.player_id
    where h.player_id = ${playerId}::uuid and p.tenant_id = ${tenantId}::uuid
    order by h.created_at desc limit 1
  `);
  const league = current.rows[0];
  const movement = last.rows[0];
  return {
    tier,
    tierName: tierName(tier),
    weekEndsAt: week.end!.toISOString(),
    league: league ? { id: league.id, name: league.name, group: Number(league.tier_group) } : null,
    lastMovement: movement
      ? { from: movement.from_tier, to: movement.to_tier, rank: Number(movement.rank) }
      : null,
  };
}

export interface TierJoinResult {
  leagueId: string;
  created: boolean;
}

/**
 * Oyuncuyu bu haftanın kademe grubuna yerleştirir (K-034). Oyuncunun kademesindeki, dolmamış (en fazla 50) ilk
 * grup seçilir; yoksa yeni grup açılır. Yerleştirme, (platform, kademe, hafta) başına danışma kilidiyle
 * sıralanır: eşzamanlı katılımlar 50 kişiyi aşamaz ve aynı grup numarası iki kez açılmaz. Aynı hafta ikinci
 * çağrı mevcut üyeliği döner (ikinci bakiye verilmez).
 */
export async function joinTierLeague(
  db: Database,
  tenantId: string,
  playerId: string,
  now: Date,
): Promise<TierJoinResult> {
  const week = questWindow('weekly', now);
  const weekStart = week.start!;
  const weekEnd = week.end!;

  return db.transaction(async (tx: Tx) => {
    const tier = await playerTier(tx, tenantId, playerId);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`tier-join:${tenantId}:${tier}:${week.key}`}, 0))`,
    );

    const existing = await tx.execute<{ id: string }>(sql`
      select l.id from leagues l join memberships m on m.league_id = l.id
      where m.player_id = ${playerId}::uuid and l.tenant_id = ${tenantId}::uuid
        and l.type = 'tier' and l.starts_at = ${weekStart.toISOString()}::timestamptz
    `);
    if (existing.rows[0]) return { leagueId: existing.rows[0].id, created: false };

    // Grup dolu değilse onu, yoksa yenisini kullan. Sayım lig başına tek sorguda.
    const open = await tx.execute<{ id: string }>(sql`
      select l.id from leagues l
      where l.tenant_id = ${tenantId}::uuid and l.type = 'tier' and l.tier = ${tier}
        and l.starts_at = ${weekStart.toISOString()}::timestamptz and l.status = 'active'
        and (select count(*) from memberships m where m.league_id = l.id) < ${TIER_LEAGUE.groupSize}::int
      order by l.tier_group limit 1
    `);

    let leagueId = open.rows[0]?.id;
    if (!leagueId) {
      const tenantAssets = await tx
        .select({ id: assets.id })
        .from(assets)
        .where(eq(assets.tenantId, tenantId))
        .orderBy(asc(assets.symbol))
        .limit(LEAGUE_LIMITS.assetsMax);
      if (tenantAssets.length === 0) throw new AppError('CONFLICT', 409, 'Bu platformda henüz varlık yok.');

      const next = await tx.execute<{ n: number }>(sql`
        select coalesce(max(l.tier_group), 0)::int + 1 as n from leagues l
        where l.tenant_id = ${tenantId}::uuid and l.type = 'tier' and l.tier = ${tier}
          and l.starts_at = ${weekStart.toISOString()}::timestamptz
      `);
      const group = Number(next.rows[0]?.n ?? 1);
      const [created] = await tx
        .insert(leagues)
        .values({
          tenantId,
          name: `${tierName(tier)} Ligi, grup ${group} (${week.key})`,
          type: 'tier',
          status: 'active',
          startsAt: weekStart,
          endsAt: weekEnd,
          startingCash: TIER_LEAGUE.startingCash,
          assetIds: tenantAssets.map((a) => a.id),
          maxMembers: TIER_LEAGUE.groupSize,
          lateJoinAllowed: true,
          tier,
          tierGroup: group,
        })
        .returning({ id: leagues.id });
      leagueId = created!.id;
    }

    await tx
      .insert(memberships)
      .values({ leagueId, playerId, cash: TIER_LEAGUE.startingCash })
      .onConflictDoNothing();
    return { leagueId, created: true };
  });
}
