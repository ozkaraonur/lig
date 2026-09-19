import { Inject, Injectable } from '@nestjs/common';
import { inArray, isNotNull } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { assets, tenants } from '../db/schema';
import { type EquityAsset, type PriceFeedDirectory, type PriceFeedSource } from './ports';

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
      .select({
        tenantId: assets.tenantId,
        symbol: assets.symbol,
        assetClass: assets.assetClass,
        referenceClose: assets.referenceClose,
        referenceCloseDate: assets.referenceCloseDate,
      })
      .from(assets)
      .where(
        inArray(
          assets.tenantId,
          feeds.map((f) => f.tenantId),
        ),
      );
    const symbolsByTenant = new Map<string, Set<string>>();
    const equitiesByTenant = new Map<string, Map<string, EquityAsset>>();
    for (const row of rows) {
      const set = symbolsByTenant.get(row.tenantId) ?? new Set<string>();
      set.add(row.symbol);
      symbolsByTenant.set(row.tenantId, set);
      if (row.assetClass !== 'equity') continue;
      const equities = equitiesByTenant.get(row.tenantId) ?? new Map<string, EquityAsset>();
      equities.set(row.symbol, {
        symbol: row.symbol,
        referenceClose: row.referenceClose,
        referenceCloseDate: row.referenceCloseDate,
      });
      equitiesByTenant.set(row.tenantId, equities);
    }

    return feeds.flatMap((f) =>
      f.url
        ? [
            {
              tenantId: f.tenantId,
              url: f.url,
              symbols: symbolsByTenant.get(f.tenantId) ?? new Set<string>(),
              equities: equitiesByTenant.get(f.tenantId) ?? new Map<string, EquityAsset>(),
            },
          ]
        : [],
    );
  }
}
