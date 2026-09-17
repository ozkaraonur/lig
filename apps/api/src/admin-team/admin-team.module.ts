import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { AccountService } from './account.service';
import { DrizzleTeamRepository } from './drizzle-team.repository';
import { TEAM_REPOSITORY } from './ports';
import { AccountController, AuditController, InvitesController, TeamController } from './team.controllers';
import { TeamService } from './team.service';

@Module({
  imports: [AuthModule, AdminAuthModule],
  controllers: [TeamController, InvitesController, AccountController, AuditController],
  providers: [TeamService, AccountService, { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository }],
})
export class AdminTeamModule {}
