import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminQuestsController, BrandingController } from './admin-settings.controllers';
import { AdminSettingsService } from './admin-settings.service';
import { DrizzleAdminQuestRepository, DrizzleBrandingRepository } from './drizzle-admin-settings';
import { ADMIN_QUEST_REPOSITORY, BRANDING_REPOSITORY } from './ports';

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminQuestsController, BrandingController],
  providers: [
    AdminSettingsService,
    { provide: ADMIN_QUEST_REPOSITORY, useClass: DrizzleAdminQuestRepository },
    { provide: BRANDING_REPOSITORY, useClass: DrizzleBrandingRepository },
  ],
})
export class AdminSettingsModule {}
