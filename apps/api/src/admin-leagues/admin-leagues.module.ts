import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminLeaguesController, ComplianceController } from './admin-leagues.controllers';
import { AdminLeaguesService } from './admin-leagues.service';
import { DrizzleAdminLeagueRepository, DrizzleComplianceRepository } from './drizzle-admin-leagues';
import { ADMIN_LEAGUE_REPOSITORY, COMPLIANCE_REPOSITORY } from './ports';

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminLeaguesController, ComplianceController],
  providers: [
    AdminLeaguesService,
    { provide: ADMIN_LEAGUE_REPOSITORY, useClass: DrizzleAdminLeagueRepository },
    { provide: COMPLIANCE_REPOSITORY, useClass: DrizzleComplianceRepository },
  ],
})
export class AdminLeaguesModule {}
