import { Module } from '@nestjs/common';
import { CLOCK_MS, systemClockMs } from '../common/clock';
import { DrizzleAssetCloseRepository } from './drizzle-asset-close.repository';
import { DrizzlePriceFeedDirectory } from './drizzle-feed.directory';
import { HttpPriceFeedClient } from './http-feed.client';
import { MarketCloseService } from './market-close.service';
import { ASSET_CLOSE_REPOSITORY, PRICE_FEED_CLIENT, PRICE_FEED_DIRECTORY, PRICE_STORE } from './ports';
import { PriceIngestService } from './price-ingest.service';
import { PriceIngestWorker } from './price-ingest.worker';
import { PriceService } from './price.service';
import { RedisPriceStore } from './redis-price.store';

@Module({
  providers: [
    PriceService,
    PriceIngestService,
    PriceIngestWorker,
    MarketCloseService,
    { provide: CLOCK_MS, useValue: systemClockMs },
    { provide: PRICE_STORE, useClass: RedisPriceStore },
    { provide: PRICE_FEED_CLIENT, useClass: HttpPriceFeedClient },
    { provide: PRICE_FEED_DIRECTORY, useClass: DrizzlePriceFeedDirectory },
    { provide: ASSET_CLOSE_REPOSITORY, useClass: DrizzleAssetCloseRepository },
  ],
  exports: [PriceService],
})
export class PricesModule {}
