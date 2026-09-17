import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CLOCK_MS, systemClockMs } from '../common/clock';
import { OutboxWorker } from './outbox.worker';
import { QuestsService } from './quest-evaluator';
import { QuestsController } from './quests.controller';

@Module({
  imports: [AuthModule],
  controllers: [QuestsController],
  providers: [QuestsService, OutboxWorker, { provide: CLOCK_MS, useValue: systemClockMs }],
})
export class QuestsModule {}
