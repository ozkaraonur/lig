import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, ne, or, type SQL, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { assets, leagues, memberships } from '../db/schema';
import {
  type AssetRecord,
  FINISHED_LEAGUE_VISIBILITY_DAYS,
  type LeagueRecord,
  type LeagueRepository,
  MAX_LISTED_LEAGUES,
  type MembershipRecord,
} from './ports';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DrizzleLeagueRepository implements LeagueRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listVisible(tenantId: string, playerId: string, now: Date): Promise<LeagueRecord[]> {
    const recentCutoff = new Date(now.getTime() - FINISHED_LEAGUE_VISIBILITY_DAYS * DAY_MS);
    return this.selectLeagues(
      playerId,
      and(this.visibleTo(tenantId), or(eq(leagues.status, 'active'), gt(leagues.endsAt, recentCutoff))),
    )
      .orderBy(asc(leagues.startsAt), asc(leagues.id))
      .limit(MAX_LISTED_LEAGUES);
  }

  async findVisible(tenantId: string, leagueId: string, playerId: string): Promise<LeagueRecord | null> {
    const [row] = await this.selectLeagues(
      playerId,
      and(this.visibleTo(tenantId), eq(leagues.id, leagueId)),
    ).limit(1);
    return row ?? null;
  }

  async findAssets(tenantId: string, assetIds: string[]): Promise<AssetRecord[]> {
    if (assetIds.length === 0) return [];
    return this.db
      .select({ id: assets.id, symbol: assets.symbol, name: assets.name, assetClass: assets.assetClass })
      .from(assets)
      .where(and(eq(assets.tenantId, tenantId), inArray(assets.id, assetIds)));
  }

  async findMembership(leagueId: string, playerId: string): Promise<MembershipRecord | null> {
    const [row] = await this.db
      .select(membershipColumns)
      .from(memberships)
      .where(and(eq(memberships.leagueId, leagueId), eq(memberships.playerId, playerId)))
      .limit(1);
    return row ?? null;
  }

  async createMembership(
    tenantId: string,
    leagueId: string,
    playerId: string,
    now: Date,
  ): Promise<MembershipRecord | null> {
    // INSERT ... SELECT: lig koşulları ve kayıt aynı cümlede. Kontrol ile yazma arasında lig kapanamaz,
    // aynı anda gelen iki katılma isteği iki üyelik açamaz (unique + ON CONFLICT DO NOTHING).
    // Tablo ve kolon adları bilerek düz yazıldı: Drizzle, ham SQL içindeki kolon referanslarını tablo adı
    // olmadan üretir; iç içe sorgularda bu, kolonun yanlış tabloya bağlanmasına yol açar.
    const result = await this.db.execute<{
      id: string;
      league_id: string;
      player_id: string;
      cash: string;
      joined_at: Date | string;
    }>(sql`
      with created as (
        insert into memberships (league_id, player_id, cash)
        select l.id, p.id, l.starting_cash
        from leagues l
        join players p on p.id = ${playerId}::uuid and p.tenant_id = l.tenant_id
        where l.id = ${leagueId}::uuid
          and l.tenant_id = ${tenantId}::uuid
          and l.status = 'active'
          and l.type <> 'friends'
          and l.ends_at > ${now.toISOString()}::timestamptz
        on conflict (league_id, player_id) do nothing
        returning id, league_id, player_id, cash, joined_at
      ),
      -- Görev olayı (FR-07) üyelikle aynı cümlede yazılır: üyelik oluşmadıysa olay da oluşmaz.
      event as (
        insert into outbox_events (tenant_id, player_id, type)
        select ${tenantId}::uuid, created.player_id, 'league_joined' from created
      )
      select * from created
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      leagueId: row.league_id,
      playerId: row.player_id,
      cash: row.cash,
      joinedAt: new Date(row.joined_at),
    };
  }

  private visibleTo(tenantId: string): SQL | undefined {
    return and(
      eq(leagues.tenantId, tenantId),
      inArray(leagues.status, ['active', 'finished']),
      ne(leagues.type, 'friends'),
    );
  }

  private selectLeagues(playerId: string, where: SQL | undefined) {
    return this.db
      .select({
        id: leagues.id,
        tenantId: leagues.tenantId,
        name: leagues.name,
        type: leagues.type,
        status: leagues.status,
        startsAt: leagues.startsAt,
        endsAt: leagues.endsAt,
        startingCash: leagues.startingCash,
        assetIds: leagues.assetIds,
        closingPrices: leagues.closingPrices,
        // Düz SQL: Drizzle, sql içindeki leagues.id referansını tablo adı olmadan yazar, alt sorguda "id"
        // memberships tablosuna bağlanırdı (entegrasyon testi bunu yakaladı).
        memberCount: sql<number>`(select count(*) from memberships m where m.league_id = leagues.id)::int`,
        joined: sql<boolean>`exists (select 1 from memberships m where m.league_id = leagues.id and m.player_id = ${playerId}::uuid)`,
      })
      .from(leagues)
      .where(where)
      .$dynamic();
  }
}

const membershipColumns = {
  id: memberships.id,
  leagueId: memberships.leagueId,
  playerId: memberships.playerId,
  cash: memberships.cash,
  joinedAt: memberships.joinedAt,
};
