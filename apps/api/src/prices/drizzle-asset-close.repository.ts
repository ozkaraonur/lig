import { Inject, Injectable } from '@nestjs/common';
import { limitStateAtClose } from '@lig/shared';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { assetLimitDays, assets } from '../db/schema';
import { type AssetCloseRepository } from './ports';

@Injectable()
export class DrizzleAssetCloseRepository implements AssetCloseRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Kapanışları, tavan/taban günlerini ve rozet sinyallerini tek transaction'da yazar (K-030). Satır önce
   * kilitlenir, önceki kapanış kilitten sonra okunur: iki süreç aynı anda yazsa ikincisi kilidi bekler, tarihi
   * artık eski olmayan satırı atlar ve tavan/taban gününü ikinci kez yazmaz.
   */
  async saveCloses(
    tenantId: string,
    sessionDate: string,
    closes: readonly { symbol: string; close: string }[],
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      let saved = 0;
      const limitUpAssetIds: string[] = [];
      for (const { symbol, close } of closes) {
        const [row] = await tx
          .select({ id: assets.id, previousClose: assets.referenceClose })
          .from(assets)
          .where(
            and(
              eq(assets.tenantId, tenantId),
              eq(assets.symbol, symbol),
              eq(assets.assetClass, 'equity'),
              // Daha yeni bir kapanış varsa geri alınmaz: iki süreç aynı anda yazsa da sonuç aynı.
              or(isNull(assets.referenceCloseDate), lt(assets.referenceCloseDate, sessionDate)),
            ),
          )
          .for('update');
        if (!row) continue;

        await tx
          .update(assets)
          .set({ referenceClose: close, referenceCloseDate: sessionDate })
          .where(eq(assets.id, row.id));
        saved += 1;

        const kind = limitStateAtClose(close, row.previousClose);
        if (kind) {
          await tx
            .insert(assetLimitDays)
            .values({ assetId: row.id, tenantId, sessionDate, kind })
            .onConflictDoNothing();
          if (kind === 'limit_up') limitUpAssetIds.push(row.id);
        }
      }

      if (limitUpAssetIds.length > 0) {
        // O gün tavan hissesinden alış yapan oyuncular rozet için yeniden değerlendirilir (K-013 outbox).
        // Gün Türkiye takvimiyle (UTC+3) hesaplanır: rozet sorgusuyla aynı tanım.
        await tx.execute(sql`
          insert into outbox_events (tenant_id, player_id, type)
          select distinct l.tenant_id, m.player_id, 'badge_recheck'::outbox_event_type
          from virtual_orders o
          join memberships m on m.id = o.membership_id
          join leagues l on l.id = m.league_id
          where l.tenant_id = ${tenantId}::uuid and o.side = 'buy'
            and o.asset_id in (${sql.join(
              limitUpAssetIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})
            and ((o.created_at at time zone 'UTC') + interval '3 hours')::date = ${sessionDate}::date
        `);
      }
      return saved;
    });
  }
}
