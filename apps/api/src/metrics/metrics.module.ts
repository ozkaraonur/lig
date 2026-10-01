import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { CLOCK_MS, systemClockMs } from '../common/clock';
import { DrizzleMetricsRepository, DrizzleRealTradeClickRepository } from './drizzle-metrics';
import { AdminMetricsController, RealTradeClickController } from './metrics.controllers';
import { MetricsService } from './metrics.service';
import { METRICS_REPOSITORY, REAL_TRADE_CLICK_REPOSITORY } from './ports';

@Module({
  imports: [AdminAuthModule, AuthModule],
  controllers: [AdminMetricsController, RealTradeClickController],
  providers: [
    MetricsService,
    { provide: CLOCK_MS, useValue: systemClockMs },
    { provide: METRICS_REPOSITORY, useClass: DrizzleMetricsRepository },
    { provide: REAL_TRADE_CLICK_REPOSITORY, useClass: DrizzleRealTradeClickRepository },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
