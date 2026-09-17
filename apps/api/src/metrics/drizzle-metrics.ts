import { Inject, Injectable } from '@nestjs/common';
import { type LeagueMetricRow, type LeagueStatus } from '@lig/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { leagues, memberships, realTradeClicks } from '../db/schema';
import {
  type MetricsRepository,
  type MetricsSnapshot,
  type RealTradeClick,
  type RealTradeClickRepository,
} from './ports';

/** Sayılar sorgudan `int` olarak gelir; boş tabloda 0. */
const n = (value: unknown): number => Number(value ?? 0);

interface TotalsRow extends Record<string, unknown> {
  players: number;
  active_players: number;
  joins: number;
  orders: number;
  quests_completed: number;
  xp_granted: number;
  real_trade_clicks: number;
  real_trade_click_players: number;
  real_trades: number;
  accounts_opened: number;
  league_players: number;
  module_players: number;
  outsiders: number;
}

interface LeagueRow extends Record<string, unknown> {
  id: string;
  name: string;
  status: LeagueStatus;
  members: number;
  orders: number;
  real_trade_clicks: number;
}

/** Panoda gösterilen lig sayısı; daha eskisi liste yerine lig ekranından incelenir. */
const LEAGUE_ROW_LIMIT = 50;

/**
 * Metrikler canlı sorgulanır (K-025). Her sorgu tenant'a bağlı; başka platformun verisi sayıma giremez
 * (NFR-03). Dönem dışı kalan tek sayı toplam oyuncudur, o platformun bugünkü büyüklüğünü gösterir.
 */
@Injectable()
export class DrizzleMetricsRepository implements MetricsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async snapshot(tenantId: string, since: Date, now: Date): Promise<MetricsSnapshot> {
    const [totals, leagueRows] = await Promise.all([
      this.totals(tenantId, since, now),
      this.leagues(tenantId, since, now),
    ]);
    return { ...totals, leagues: leagueRows };
  }

  private async totals(
    tenantId: string,
    since: Date,
    now: Date,
  ): Promise<Pick<MetricsSnapshot, 'totals' | 'realTradeBreakdown'>> {
    const t = tenantId;
    const from = since.toISOString();
    const to = now.toISOString();
    const result = await this.db.execute<TotalsRow>(sql`
      with tenant_memberships as (
        select m.id, m.player_id, m.joined_at
        from memberships m
        join leagues l on l.id = m.league_id
        where l.tenant_id = ${t}::uuid
      ),
      period_orders as (
        select o.id, tm.player_id
        from virtual_orders o
        join tenant_memberships tm on tm.id = o.membership_id
        where o.created_at >= ${from}::timestamptz and o.created_at < ${to}::timestamptz
      ),
      active as (
        select player_id from tenant_memberships
        where joined_at >= ${from}::timestamptz and joined_at < ${to}::timestamptz
        union
        select player_id from period_orders
      ),
      -- Gerçek işlem yapan farklı kullanıcılar, lig modülüyle ilişkilerine göre (FR-23).
      traders as (
        select
          e.external_player_id,
          -- Aynı kullanıcının ilk olayı modülü açmadan önce gelmiş olabilir: bir kez bile eşleşmişse bilinir.
          bool_or(e.player_id is not null) as known,
          bool_or(exists (select 1 from tenant_memberships tm where tm.player_id = e.player_id)) as in_league
        from platform_events e
        where e.tenant_id = ${t}::uuid
          and e.type = 'real_trade'
          and e.occurred_at >= ${from}::timestamptz and e.occurred_at < ${to}::timestamptz
        group by e.external_player_id
      )
      select
        (select count(*) from players p where p.tenant_id = ${t}::uuid)::int as players,
        (select count(*) from active)::int as active_players,
        (select count(*) from tenant_memberships
          where joined_at >= ${from}::timestamptz and joined_at < ${to}::timestamptz)::int as joins,
        (select count(*) from period_orders)::int as orders,
        (select count(*) from quest_progress qp
          join quests q on q.id = qp.quest_id and q.tenant_id = ${t}::uuid
          where qp.completed_at >= ${from}::timestamptz
            and qp.completed_at < ${to}::timestamptz)::int as quests_completed,
        (select coalesce(sum(x.amount), 0) from xp_ledger x
          join players p on p.id = x.player_id and p.tenant_id = ${t}::uuid
          where x.created_at >= ${from}::timestamptz and x.created_at < ${to}::timestamptz)::int as xp_granted,
        (select count(*) from real_trade_clicks c
          where c.tenant_id = ${t}::uuid
            and c.created_at >= ${from}::timestamptz
            and c.created_at < ${to}::timestamptz)::int as real_trade_clicks,
        (select count(distinct c.player_id) from real_trade_clicks c
          where c.tenant_id = ${t}::uuid
            and c.created_at >= ${from}::timestamptz
            and c.created_at < ${to}::timestamptz)::int as real_trade_click_players,
        (select count(*) from platform_events e
          where e.tenant_id = ${t}::uuid and e.type = 'real_trade'
            and e.occurred_at >= ${from}::timestamptz
            and e.occurred_at < ${to}::timestamptz)::int as real_trades,
        (select count(*) from platform_events e
          where e.tenant_id = ${t}::uuid and e.type = 'account_opened'
            and e.occurred_at >= ${from}::timestamptz
            and e.occurred_at < ${to}::timestamptz)::int as accounts_opened,
        (select count(*) from traders where in_league)::int as league_players,
        (select count(*) from traders where known and not in_league)::int as module_players,
        (select count(*) from traders where not known)::int as outsiders
    `);
    const row = result.rows[0];
    return {
      totals: {
        players: n(row?.players),
        activePlayers: n(row?.active_players),
        joins: n(row?.joins),
        orders: n(row?.orders),
        questsCompleted: n(row?.quests_completed),
        xpGranted: n(row?.xp_granted),
        realTradeClicks: n(row?.real_trade_clicks),
        realTradeClickPlayers: n(row?.real_trade_click_players),
        realTrades: n(row?.real_trades),
        accountsOpened: n(row?.accounts_opened),
      },
      realTradeBreakdown: {
        leaguePlayers: n(row?.league_players),
        modulePlayers: n(row?.module_players),
        outsiders: n(row?.outsiders),
      },
    };
  }

  private async leagues(tenantId: string, since: Date, now: Date): Promise<LeagueMetricRow[]> {
    const from = since.toISOString();
    const to = now.toISOString();
    const result = await this.db.execute<LeagueRow>(sql`
      select
        l.id,
        l.name,
        l.status,
        (select count(*) from memberships m where m.league_id = l.id)::int as members,
        (select count(*) from virtual_orders o
          join memberships m on m.id = o.membership_id and m.league_id = l.id
          where o.created_at >= ${from}::timestamptz
            and o.created_at < ${to}::timestamptz)::int as orders,
        (select count(*) from real_trade_clicks c
          where c.league_id = l.id
            and c.created_at >= ${from}::timestamptz
            and c.created_at < ${to}::timestamptz)::int as real_trade_clicks
      from leagues l
      where l.tenant_id = ${tenantId}::uuid
      order by l.starts_at desc, l.id
      limit ${LEAGUE_ROW_LIMIT}
    `);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      members: n(row.members),
      orders: n(row.orders),
      realTradeClicks: n(row.real_trade_clicks),
    }));
  }
}

@Injectable()
export class DrizzleRealTradeClickRepository implements RealTradeClickRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(click: RealTradeClick): Promise<void> {
    // Lig kimliği oyuncudan geliyor: üyeliği doğrulanmazsa oyuncu başkasının liginin sayısını şişirebilirdi.
    const leagueId = click.leagueId ? await this.memberLeague(click.playerId, click.leagueId) : null;
    await this.db
      .insert(realTradeClicks)
      .values({ tenantId: click.tenantId, playerId: click.playerId, leagueId });
  }

  private async memberLeague(playerId: string, leagueId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: memberships.leagueId })
      .from(memberships)
      .innerJoin(leagues, eq(leagues.id, memberships.leagueId))
      .where(and(eq(memberships.playerId, playerId), eq(memberships.leagueId, leagueId)))
      .limit(1);
    return row?.id ?? null;
  }
}
