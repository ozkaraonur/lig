import { CSV_MAX_ROWS } from '@lig/shared';
import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { CLOCK_MS, systemClockMs } from '../common/clock';
import { MetricsModule } from '../metrics/metrics.module';
import { ExportsController } from './exports.controller';
import { EXPORT_MAX_ROWS, ExportsService } from './exports.service';

@Module({
  imports: [AdminAuthModule, MetricsModule],
  controllers: [ExportsController],
  providers: [
    ExportsService,
    { provide: CLOCK_MS, useValue: systemClockMs },
    { provide: EXPORT_MAX_ROWS, useValue: CSV_MAX_ROWS },
  ],
})
export class ExportsModule {}
