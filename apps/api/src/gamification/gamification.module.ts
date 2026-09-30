import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DrizzleAppearanceReader, DrizzleProfileRepository } from './drizzle-profile';
import { APPEARANCE_READER, PROFILE_REPOSITORY } from './ports';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [AuthModule],
  controllers: [ProfileController],
  providers: [
    ProfileService,
    { provide: PROFILE_REPOSITORY, useClass: DrizzleProfileRepository },
    { provide: APPEARANCE_READER, useClass: DrizzleAppearanceReader },
  ],
  exports: [APPEARANCE_READER],
})
export class GamificationModule {}
