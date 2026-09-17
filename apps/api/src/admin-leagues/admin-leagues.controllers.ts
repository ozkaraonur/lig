import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AdminAssetView,
  type AdminLeagueView,
  type ComplianceUpdateRequest,
  complianceUpdateRequest,
  type ComplianceView,
  type CreateLeagueRequest,
  createLeagueRequest,
  leagueIdParam,
  type UpdateLeagueRequest,
  updateLeagueRequest,
} from '@lig/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AdminRoles,
  AdminSessionGuard,
  type AuthenticatedAdmin,
  CurrentAdmin,
} from '../admin-auth/admin-session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminLeaguesService } from './admin-leagues.service';

/** FR-20. Her rol görür; sahip ve düzenleyici değiştirir. Bütün sorgular oturumdaki platformla sınırlı. */
@Controller('admin/leagues')
@UseGuards(AdminSessionGuard)
export class AdminLeaguesController {
  constructor(private readonly leagues: AdminLeaguesService) {}

  @Get()
  async list(@CurrentAdmin() admin: AuthenticatedAdmin, @Res({ passthrough: true }) reply: FastifyReply) {
    void reply.header('cache-control', 'no-store');
    return { leagues: await this.leagues.list(admin.account) } satisfies { leagues: AdminLeagueView[] };
  }

  @Get('assets')
  async assets(@CurrentAdmin() admin: AuthenticatedAdmin, @Res({ passthrough: true }) reply: FastifyReply) {
    void reply.header('cache-control', 'no-store');
    return { assets: await this.leagues.assets(admin.account) } satisfies { assets: AdminAssetView[] };
  }

  @Get(':leagueId')
  async get(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('leagueId', new ZodValidationPipe(leagueIdParam)) leagueId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('cache-control', 'no-store');
    return { league: await this.leagues.get(admin.account, leagueId) } satisfies { league: AdminLeagueView };
  }

  @Post()
  @HttpCode(201)
  @AdminRoles('owner', 'editor')
  async create(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body(new ZodValidationPipe(createLeagueRequest)) body: CreateLeagueRequest,
    @Req() request: FastifyRequest,
  ) {
    return { league: await this.leagues.create(admin.account, body, request.ip) } satisfies {
      league: AdminLeagueView;
    };
  }

  @Patch(':leagueId')
  @AdminRoles('owner', 'editor')
  async update(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('leagueId', new ZodValidationPipe(leagueIdParam)) leagueId: string,
    @Body(new ZodValidationPipe(updateLeagueRequest)) body: UpdateLeagueRequest,
    @Req() request: FastifyRequest,
  ) {
    return { league: await this.leagues.update(admin.account, leagueId, body, request.ip) } satisfies {
      league: AdminLeagueView;
    };
  }

  @Delete(':leagueId')
  @HttpCode(204)
  @AdminRoles('owner', 'editor')
  async remove(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('leagueId', new ZodValidationPipe(leagueIdParam)) leagueId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.leagues.remove(admin.account, leagueId, request.ip);
  }
}

/** FR-24. Her rol görür; yalnızca sahip ayarlanabilir olanları değiştirir. Kilitli ayarların yazma ucu yok. */
@Controller('admin/compliance')
@UseGuards(AdminSessionGuard)
export class ComplianceController {
  constructor(private readonly leagues: AdminLeaguesService) {}

  @Get()
  async get(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ComplianceView> {
    void reply.header('cache-control', 'no-store');
    return this.leagues.complianceView(admin.account);
  }

  @Patch()
  @AdminRoles('owner')
  update(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body(new ZodValidationPipe(complianceUpdateRequest)) body: ComplianceUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<ComplianceView> {
    return this.leagues.updateCompliance(admin.account, body, request.ip);
  }
}
