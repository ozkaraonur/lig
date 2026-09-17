import { randomUUID } from 'node:crypto';
import { type InMemoryLeagueRepository } from '../leagues/fakes.test-utils';
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

interface StoredPosition extends PositionRecord {
  membershipId: string;
}

/**
 * Bellek içi emir veritabanı. Lig, varlık ve üyelikleri InMemoryLeagueRepository ile paylaşır.
 * Transaction'lar sırayla çalışır (tek kilit) ve hata olursa bütün değişiklikler geri alınır.
 */
export class InMemoryOrders implements OrderUnitOfWork, PortfolioReader {
  positions: StoredPosition[] = [];
  orders: OrderRecord[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  /** true ise bir sonraki emir kaydı hata verir: transaction'ın geri alındığını sınamak için. */
  failNextInsert = false;

  constructor(
    private readonly leagues: InMemoryLeagueRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  run<T>(work: (tx: OrderTransaction) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const snapshot = {
        positions: structuredClone(this.positions),
        orders: structuredClone(this.orders),
        cash: this.leagues.memberships.map((m) => [m, m.cash] as const),
      };
      try {
        return await work(this.transaction());
      } catch (err) {
        this.positions = snapshot.positions;
        this.orders = snapshot.orders;
        for (const [m, cash] of snapshot.cash) m.cash = cash;
        throw err;
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async listPositions(membershipId: string) {
    return this.positions
      .filter((p) => p.membershipId === membershipId)
      .map(({ membershipId: _m, ...p }) => {
        const asset = this.leagues.assets.find((a) => a.id === p.assetId)!;
        return { ...p, symbol: asset.symbol, name: asset.name };
      })
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async listOrders(membershipId: string, limit: number) {
    return this.orders
      .filter((o) => o.membershipId === membershipId)
      .reverse()
      .slice(0, limit)
      .map((o) => ({ ...o, symbol: this.leagues.assets.find((a) => a.id === o.assetId)!.symbol }));
  }

  private transaction(): OrderTransaction {
    const leagues = this.leagues;
    return {
      lockLeague: async (tenantId, leagueId): Promise<TradingLeague | null> => {
        const l = leagues.leagues.find(
          (x) => x.id === leagueId && x.tenantId === tenantId && x.status !== 'draft' && x.type !== 'friends',
        );
        return l ? { ...l, assetIds: [...l.assetIds] } : null;
      },
      lockMembership: async (leagueId, playerId): Promise<LockedMembership | null> => {
        const m = leagues.memberships.find((x) => x.leagueId === leagueId && x.playerId === playerId);
        return m ? { id: m.id, cash: m.cash } : null;
      },
      findOrderByIdempotencyKey: async (membershipId, key) => {
        return this.orders.find((o) => o.membershipId === membershipId && o.idempotencyKey === key) ?? null;
      },
      findAsset: async (tenantId, assetId): Promise<TradingAsset | null> => {
        const a = leagues.assets.find((x) => x.id === assetId && x.tenantId === tenantId);
        return a ? { id: a.id, symbol: a.symbol, name: a.name } : null;
      },
      findPosition: async (membershipId, assetId) => {
        const p = this.positions.find((x) => x.membershipId === membershipId && x.assetId === assetId);
        return p ? { assetId: p.assetId, quantity: p.quantity, avgCost: p.avgCost } : null;
      },
      setCash: async (membershipId, cash) => {
        if (cash.startsWith('-')) throw new Error('memberships_cash_non_negative');
        leagues.memberships.find((m) => m.id === membershipId)!.cash = cash;
      },
      savePosition: async (membershipId, position) => {
        this.positions = this.positions.filter(
          (p) => !(p.membershipId === membershipId && p.assetId === position.assetId),
        );
        if (!/^0+(\.0+)?$/.test(position.quantity)) this.positions.push({ membershipId, ...position });
      },
      insertOrder: async (order: NewOrder) => {
        if (this.failNextInsert) {
          this.failNextInsert = false;
          throw new Error('simulated database failure');
        }
        const record = { ...order, id: randomUUID(), createdAt: this.now() };
        this.orders.push(record);
        return record;
      },
    };
  }
}
