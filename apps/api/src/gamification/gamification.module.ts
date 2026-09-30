import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CLOCK_MS, systemClockMs } from '../common/clock';
import { DrizzleAppearanceReader, DrizzleProfileRepository } from './drizzle-profile';
import { APPEARANCE_READER, PROFILE_REPOSITORY } from './ports';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { StreakController } from './streak.controller';
import { StreakService } from './streak.service';

@Module({
  imports: [AuthModule],
  controllers: [ProfileController, StreakController],
  providers: [
    ProfileService,
    StreakService,
    { provide: CLOCK_MS, useValue: systemClockMs },
    { provide: PROFILE_REPOSITORY, useClass: DrizzleProfileRepository },
    { provide: APPEARANCE_READER, useClass: DrizzleAppearanceReader },
  ],
  exports: [APPEARANCE_READER],
})
export class GamificationModule {}
