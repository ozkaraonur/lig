import { outboxEvents } from '../db/schema';
import { type DbExecutor } from '../xp/xp-ledger';

export type OutboxEventType = (typeof outboxEvents.type.enumValues)[number];

export interface OutboxEvent {
  tenantId: string;
  playerId: string;
  type: OutboxEventType;
}

/** Olayı çağıranın transaction'ı içinde yazar: iş kaydı ve olay ya birlikte yazılır ya hiç (K-013). */
export async function recordOutboxEvent(db: DbExecutor, event: OutboxEvent): Promise<void> {
  await db.insert(outboxEvents).values(event);
}
