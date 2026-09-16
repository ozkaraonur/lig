import { Module } from '@nestjs/common';
import { CLOCK_MS, systemClockMs } from '../common/clock';
import { DrizzlePriceFeedDirectory } from './drizzle-feed.directory';
import { HttpPriceFeedClient } from './http-feed.client';
import { PRICE_FEED_CLIENT, PRICE_FEED_DIRECTORY, PRICE_STORE } from './ports';
import { PriceIngestService } from './price-ingest.service';
import { PriceIngestWorker } from './price-ingest.worker';
import { PriceService } from './price.service';
import { RedisPriceStore } from './redis-price.store';

@Module({
  providers: [
    PriceService,
    PriceIngestService,
    PriceIngestWorker,
    { provide: CLOCK_MS, useValue: systemClockMs },
    { provide: PRICE_STORE, useClass: RedisPriceStore },
    { provide: PRICE_FEED_CLIENT, useClass: HttpPriceFeedClient },
    { provide: PRICE_FEED_DIRECTORY, useClass: DrizzlePriceFeedDirectory },
  ],
  exports: [PriceService],
})
export class PricesModule {}
