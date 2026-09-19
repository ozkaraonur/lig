import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { assets } from '../db/schema';
import { type AssetCloseRepository } from './ports';

@Injectable()
export class DrizzleAssetCloseRepository implements AssetCloseRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async saveCloses(
    tenantId: string,
    sessionDate: string,
    closes: readonly { symbol: string; close: string }[],
  ): Promise<number> {
    let saved = 0;
    for (const { symbol, close } of closes) {
      const rows = await this.db
        .update(assets)
        .set({ referenceClose: close, referenceCloseDate: sessionDate })
        .where(
          and(
            eq(assets.tenantId, tenantId),
            eq(assets.symbol, symbol),
            eq(assets.assetClass, 'equity'),
            // Daha yeni bir kapanış varsa geri alınmaz: iki süreç aynı anda yazsa da sonuç aynı.
            or(isNull(assets.referenceCloseDate), lt(assets.referenceCloseDate, sessionDate)),
          ),
        )
        .returning({ id: assets.id });
      saved += rows.length;
    }
    return saved;
  }
}
