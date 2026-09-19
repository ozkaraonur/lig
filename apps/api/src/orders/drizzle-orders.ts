import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { type OutboxEvent, recordOutboxEvent } from '../outbox/outbox';
import { assets, memberships, positions, virtualOrders } from '../db/schema';
import {
  type LockedMembership,
  type NewOrder,
  type OrderRecord,
  type OrderTransaction,
  type OrderUnitOfWork,
  type PortfolioReader,
  type PositionRecord,
  type TradingAsset,
  type TradingLeague,
} from './ports';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const orderColumns = {
  id: virtualOrders.id,
  membershipId: virtualOrders.membershipId,
  assetId: virtualOrders.assetId,
  side: virtualOrders.side,
  amount: virtualOrders.amount,
  price: virtualOrders.price,
  quantity: virtualOrders.quantity,
  idempotencyKey: virtualOrders.idempotencyKey,
  requestHash: virtualOrders.requestHash,
  createdAt: virtualOrders.createdAt,
};

class DrizzleOrderTransaction implements OrderTransaction {
  constructor(private readonly tx: Tx) {}

  async lockLeague(tenantId: string, leagueId: string): Promise<TradingLeague | null> {
    // Ham SQL'de tablo adları açık yazılır (K-008).
    const result = await this.tx.execute<{
      id: string;
      status: TradingLeague['status'];
      type: TradingLeague['type'];
      starts_at: Date | string;
      ends_at: Date | string;
      starting_cash: string;
      asset_ids: string[];
    }>(sql`
      select l.id, l.status, l.type, l.starts_at, l.ends_at, l.starting_cash, l.asset_ids
      from leagues l
      where l.id = ${leagueId}::uuid
        and l.tenant_id = ${tenantId}::uuid
        and l.status in ('active', 'finished')
        and l.type <> 'friends'
      for share
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      type: row.type,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      startingCash: row.starting_cash,
      assetIds: parsePgUuidArray(row.asset_ids),
    };
  }

  async lockMembership(leagueId: string, playerId: string): Promise<LockedMembership | null> {
    const [row] = await this.tx
      .select({ id: memberships.id, cash: memberships.cash })
      .from(memberships)
      .where(and(eq(memberships.leagueId, leagueId), eq(memberships.playerId, playerId)))
      .for('update');
    return row ?? null;
  }

  async findOrderByIdempotencyKey(membershipId: string, idempotencyKey: string): Promise<OrderRecord | null> {
    const [row] = await this.tx
      .select(orderColumns)
      .from(virtualOrders)
      .where(
        and(eq(virtualOrders.membershipId, membershipId), eq(virtualOrders.idempotencyKey, idempotencyKey)),
      )
      .limit(1);
    return row ?? null;
  }

  async findAsset(tenantId: string, assetId: string): Promise<TradingAsset | null> {
    const [row] = await this.tx
      .select({
        id: assets.id,
        symbol: assets.symbol,
        name: assets.name,
        assetClass: assets.assetClass,
      })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.tenantId, tenantId)))
      .limit(1);
    return row ?? null;
  }

  async findPosition(membershipId: string, assetId: string): Promise<PositionRecord | null> {
    const [row] = await this.tx
      .select({ assetId: positions.assetId, quantity: positions.quantity, avgCost: positions.avgCost })
      .from(positions)
      .where(and(eq(positions.membershipId, membershipId), eq(positions.assetId, assetId)))
      .limit(1);
    return row ?? null;
  }

  async setCash(membershipId: string, cash: string): Promise<void> {
    await this.tx.update(memberships).set({ cash }).where(eq(memberships.id, membershipId));
  }

  async savePosition(membershipId: string, position: PositionRecord): Promise<void> {
    if (/^0+(\.0+)?$/.test(position.quantity)) {
      await this.tx
        .delete(positions)
        .where(and(eq(positions.membershipId, membershipId), eq(positions.assetId, position.assetId)));
      return;
    }
    await this.tx
      .insert(positions)
      .values({ membershipId, ...position })
      .onConflictDoUpdate({
        target: [positions.membershipId, positions.assetId],
        set: { quantity: position.quantity, avgCost: position.avgCost },
      });
  }

  recordEvent(event: OutboxEvent): Promise<void> {
    return recordOutboxEvent(this.tx, event);
  }

  async insertOrder(order: NewOrder): Promise<OrderRecord> {
    const [row] = await this.tx.insert(virtualOrders).values(order).returning(orderColumns);
    if (!row) throw new Error('Order insert returned no row');
    return row;
  }
}

/** node-postgres uuid[] kolonunu ham sorguda "{a,b}" string'i olarak dönebilir. */
function parsePgUuidArray(value: string[] | string): string[] {
  if (Array.isArray(value)) return value;
  const inner = value.replace(/^\{|\}$/g, '');
  return inner ? inner.split(',') : [];
}

@Injectable()
export class DrizzleOrderUnitOfWork implements OrderUnitOfWork {
  constructor(@Inject(DB) private readonly db: Database) {}

  run<T>(work: (tx: OrderTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleOrderTransaction(tx)));
  }
}

@Injectable()
export class DrizzlePortfolioReader implements PortfolioReader {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listPositions(membershipId: string) {
    return this.db
      .select({
        assetId: positions.assetId,
        quantity: positions.quantity,
        avgCost: positions.avgCost,
        symbol: assets.symbol,
        name: assets.name,
      })
      .from(positions)
      .innerJoin(assets, eq(assets.id, positions.assetId))
      .where(eq(positions.membershipId, membershipId))
      .orderBy(assets.symbol);
  }

  async listOrders(membershipId: string, limit: number) {
    return this.db
      .select({ ...orderColumns, symbol: assets.symbol })
      .from(virtualOrders)
      .innerJoin(assets, eq(assets.id, virtualOrders.assetId))
      .where(eq(virtualOrders.membershipId, membershipId))
      .orderBy(desc(virtualOrders.createdAt), desc(virtualOrders.id))
      .limit(limit);
  }
}
