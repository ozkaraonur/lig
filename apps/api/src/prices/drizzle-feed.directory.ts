import { Inject, Injectable } from '@nestjs/common';
import { inArray, isNotNull } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { assets, tenants } from '../db/schema';
import { type PriceFeedDirectory, type PriceFeedSource } from './ports';

@Injectable()
export class DrizzlePriceFeedDirectory implements PriceFeedDirectory {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listSources(): Promise<PriceFeedSource[]> {
    const feeds = await this.db
      .select({ tenantId: tenants.id, url: tenants.priceFeedUrl })
      .from(tenants)
      .where(isNotNull(tenants.priceFeedUrl));
    if (feeds.length === 0) return [];

    const rows = await this.db
      .select({ tenantId: assets.tenantId, symbol: assets.symbol })
      .from(assets)
      .where(
        inArray(
          assets.tenantId,
          feeds.map((f) => f.tenantId),
        ),
      );
    const symbolsByTenant = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = symbolsByTenant.get(row.tenantId) ?? new Set<string>();
      set.add(row.symbol);
      symbolsByTenant.set(row.tenantId, set);
    }

    return feeds.flatMap((f) =>
      f.url
        ? [{ tenantId: f.tenantId, url: f.url, symbols: symbolsByTenant.get(f.tenantId) ?? new Set() }]
        : [],
    );
  }
}
