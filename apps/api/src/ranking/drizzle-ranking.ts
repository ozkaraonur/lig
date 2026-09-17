import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { CASH_SCALE, formatFixed } from '../orders/fixed-point';
import { type DbExecutor, grantXp } from '../xp/xp-ledger';
import { assets, leagues, memberships, players, positions, xpLedger } from '../db/schema';
import {
  type ClosingLeague,
  type FinalStandingRow,
  type FinalStandingsReader,
  type LeagueCloseTransaction,
  type LeagueCloseUnitOfWork,
  type RankableLeague,
  type RankingSource,
} from './ports';
import { type MemberHolding, type Standing, type XpGrant } from './standings';

type Executor = DbExecutor;

async function loadHoldings(db: Executor, leagueId: string): Promise<MemberHolding[]> {
  const rows = await db
    .select({
      membershipId: memberships.id,
      playerId: memberships.playerId,
      cash: memberships.cash,
      joinedAt: memberships.joinedAt,
      assetId: positions.assetId,
      quantity: positions.quantity,
      avgCost: positions.avgCost,
      symbol: assets.symbol,
    })
    .from(memberships)
    .leftJoin(positions, eq(positions.membershipId, memberships.id))
    .leftJoin(assets, eq(assets.id, positions.assetId))
    .where(eq(memberships.leagueId, leagueId));

  const byMembership = new Map<string, MemberHolding>();
  for (const row of rows) {
    let holding = byMembership.get(row.membershipId);
    if (!holding) {
      holding = {
        membershipId: row.membershipId,
        playerId: row.playerId,
        cash: row.cash,
        joinedAt: row.joinedAt,
        positions: [],
      };
      byMembership.set(row.membershipId, holding);
    }
    if (row.assetId && row.quantity && row.avgCost && row.symbol) {
      holding.positions.push({
        assetId: row.assetId,
        symbol: row.symbol,
        quantity: row.quantity,
        avgCost: row.avgCost,
      });
    }
  }
  return [...byMembership.values()];
}

@Injectable()
export class DrizzleRankingSource implements RankingSource {
  constructor(@Inject(DB) private readonly db: Database) {}

  listRunningLeagues(now: Date): Promise<RankableLeague[]> {
    return this.db
      .select({ id: leagues.id, tenantId: leagues.tenantId })
      .from(leagues)
      .where(and(eq(leagues.status, 'active'), lte(leagues.startsAt, now), gt(leagues.endsAt, now)));
  }

  listLeaguesDueForClose(now: Date): Promise<RankableLeague[]> {
    return this.db
      .select({ id: leagues.id, tenantId: leagues.tenantId })
      .from(leagues)
      .where(and(eq(leagues.status, 'active'), lte(leagues.endsAt, now)));
  }

  loadHoldings(leagueId: string): Promise<MemberHolding[]> {
    return loadHoldings(this.db, leagueId);
  }

  async displayNames(playerIds: string[]): Promise<Map<string, string>> {
    if (playerIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: players.id, displayName: players.displayName })
      .from(players)
      .where(inArray(players.id, playerIds));
    return new Map(rows.map((r) => [r.id, r.displayName]));
  }
}

@Injectable()
export class DrizzleFinalStandingsReader implements FinalStandingsReader {
  constructor(@Inject(DB) private readonly db: Database) {}

  private select() {
    return this.db
      .select({
        playerId: memberships.playerId,
        displayName: players.displayName,
        finalRank: memberships.finalRank,
        finalValue: memberships.finalValue,
      })
      .from(memberships)
      .innerJoin(players, eq(players.id, memberships.playerId));
  }

  async top(leagueId: string, limit: number): Promise<FinalStandingRow[]> {
    const rows = await this.select()
      .where(and(eq(memberships.leagueId, leagueId), sql`${memberships.finalRank} is not null`))
      .orderBy(asc(memberships.finalRank), asc(memberships.joinedAt))
      .limit(limit);
    return rows.flatMap(toFinalRow);
  }

  async entryFor(leagueId: string, playerId: string): Promise<FinalStandingRow | null> {
    const [row] = await this.select()
      .where(and(eq(memberships.leagueId, leagueId), eq(memberships.playerId, playerId)))
      .limit(1);
    return row ? (toFinalRow(row)[0] ?? null) : null;
  }

  async count(leagueId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.leagueId, leagueId), sql`${memberships.finalRank} is not null`));
    return row?.n ?? 0;
  }

  async xpAwarded(leagueId: string, playerId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`coalesce(sum(${xpLedger.amount}), 0)::int` })
      .from(xpLedger)
      .where(
        and(
          eq(xpLedger.playerId, playerId),
          eq(xpLedger.sourceId, leagueId),
          inArray(xpLedger.reason, ['league_rank', 'league_participation']),
        ),
      );
    return row?.total ?? 0;
  }
}

function toFinalRow(row: {
  playerId: string;
  displayName: string;
  finalRank: number | null;
  finalValue: string | null;
}): FinalStandingRow[] {
  if (row.finalRank === null || row.finalValue === null) return [];
  return [
    {
      playerId: row.playerId,
      displayName: row.displayName,
      finalRank: row.finalRank,
      finalValue: row.finalValue,
    },
  ];
}

class DrizzleLeagueCloseTransaction implements LeagueCloseTransaction {
  constructor(private readonly tx: Parameters<Parameters<Database['transaction']>[0]>[0]) {}

  async lockLeague(leagueId: string): Promise<ClosingLeague | null> {
    const [row] = await this.tx
      .select({ id: leagues.id, tenantId: leagues.tenantId, status: leagues.status, endsAt: leagues.endsAt })
      .from(leagues)
      .where(eq(leagues.id, leagueId))
      .for('update');
    return row ?? null;
  }

  loadHoldings(leagueId: string): Promise<MemberHolding[]> {
    return loadHoldings(this.tx, leagueId);
  }

  async membershipsWithOrders(leagueId: string): Promise<Set<string>> {
    // Tablo adları açık yazılır (K-008).
    const result = await this.tx.execute<{ id: string }>(sql`
      select m.id from memberships m
      where m.league_id = ${leagueId}::uuid
        and exists (select 1 from virtual_orders o where o.membership_id = m.id)
    `);
    return new Set(result.rows.map((r) => r.id));
  }

  async saveFinalStandings(all: Standing[]): Promise<void> {
    for (const standings of chunks(all)) await this.saveChunk(standings);
  }

  private async saveChunk(standings: Standing[]): Promise<void> {
    // Toplu güncelleme: binlerce üyede satır başına sorgu atmamak için.
    const values = sql.join(
      standings.map(
        (s) =>
          sql`(${s.membershipId}::uuid, ${s.rank}::int, ${formatFixed(s.valueUnits, CASH_SCALE)}::numeric)`,
      ),
      sql`, `,
    );
    await this.tx.execute(sql`
      update memberships m
      set final_rank = v.rank, final_value = v.value
      from (values ${values}) as v(id, rank, value)
      where m.id = v.id
    `);
  }

  grantXp(grants: XpGrant[]): Promise<number> {
    return grantXp(this.tx, grants);
  }

  async markClosed(
    leagueId: string,
    closedAt: Date,
    closingPrices: Record<string, string | null>,
  ): Promise<void> {
    await this.tx
      .update(leagues)
      .set({ status: 'finished', closedAt, closingPrices })
      .where(eq(leagues.id, leagueId));
  }
}

/** PostgreSQL tek sorguda en fazla 65.535 parametre kabul eder; satır başına 3-4 parametreyle güvenli pay. */
const CHUNK_SIZE = 5_000;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) out.push(items.slice(i, i + CHUNK_SIZE));
  return out;
}

@Injectable()
export class DrizzleLeagueCloseUnitOfWork implements LeagueCloseUnitOfWork {
  constructor(@Inject(DB) private readonly db: Database) {}

  run<T>(work: (tx: LeagueCloseTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleLeagueCloseTransaction(tx)));
  }
}
