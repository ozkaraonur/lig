import { Module } from '@nestjs/common';
import { CLOCK_MS, systemClockMs } from '../common/clock';
import { DrizzlePlatformEventStore } from './drizzle-platform-events';
import { PLATFORM_EVENT_STORE } from './ports';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    { provide: CLOCK_MS, useValue: systemClockMs },
    { provide: PLATFORM_EVENT_STORE, useClass: DrizzlePlatformEventStore },
  ],
})
export class WebhooksModule {}
