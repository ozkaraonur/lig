import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CLOCK_MS, systemClockMs } from '../common/clock';
import { FriendsController } from './friends.controller';

@Module({
  imports: [AuthModule],
  controllers: [FriendsController],
  providers: [{ provide: CLOCK_MS, useValue: systemClockMs }],
})
export class FriendsModule {}
