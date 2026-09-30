import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CLOCK_MS, systemClockMs } from '../common/clock';
import { TiersController } from './tiers.controller';

@Module({
  imports: [AuthModule],
  controllers: [TiersController],
  providers: [{ provide: CLOCK_MS, useValue: systemClockMs }],
})
export class TiersModule {}
