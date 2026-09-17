import { Inject, Injectable } from '@nestjs/common';
import { type PlatformEventWebhook } from '@lig/shared';
import { and, eq, isNotNull } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { platformEvents, players, tenants } from '../db/schema';
import { recordOutboxEvent } from '../outbox/outbox';
import { type PlatformEventStore, type WebhookTenant } from './ports';

@Injectable()
export class DrizzlePlatformEventStore implements PlatformEventStore {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findTenant(issuer: string): Promise<WebhookTenant | null> {
    const [row] = await this.db
      .select({ tenantId: tenants.id, secret: tenants.webhookSecret })
      .from(tenants)
      .where(and(eq(tenants.ssoIssuer, issuer), isNotNull(tenants.webhookSecret)))
      .limit(1);
    return row?.secret ? { tenantId: row.tenantId, secret: row.secret } : null;
  }

  record(tenantId: string, event: PlatformEventWebhook) {
    return this.db.transaction(async (tx) => {
      const [player] = await tx
        .select({ id: players.id })
        .from(players)
        .where(and(eq(players.tenantId, tenantId), eq(players.externalId, event.playerId)))
        .limit(1);

      const inserted = await tx
        .insert(platformEvents)
        .values({
          tenantId,
          externalEventId: event.eventId,
          externalPlayerId: event.playerId,
          playerId: player?.id ?? null,
          type: event.type,
          occurredAt: new Date(event.occurredAt),
        })
        .onConflictDoNothing({ target: [platformEvents.tenantId, platformEvents.externalEventId] })
        .returning({ id: platformEvents.id });

      const duplicate = inserted.length === 0;
      if (!duplicate && player) {
        await recordOutboxEvent(tx, { tenantId, playerId: player.id, type: 'platform_event' });
      }
      return { duplicate, playerKnown: Boolean(player) };
    });
  }
}
