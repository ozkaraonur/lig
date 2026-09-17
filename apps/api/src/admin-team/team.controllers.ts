import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ADMIN_SESSION_COOKIE_NAME,
  type AdminInviteAcceptRequest,
  adminInviteAcceptRequest,
  type AdminInviteCreatedResponse,
  type AdminInviteLookupRequest,
  adminInviteLookupRequest,
  type AdminInviteLookupResponse,
  type AdminInviteRequest,
  adminInviteRequest,
  type AdminPasswordChangeRequest,
  adminPasswordChangeRequest,
  type AdminRoleChangeRequest,
  adminRoleChangeRequest,
  type AdminTeamResponse,
  type AuditListQuery,
  auditListQuery,
  type AuditListResponse,
  type AuditVerifyResponse,
} from '@lig/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminCookieOptions } from '../admin-auth/admin-auth.controller';
import {
  AdminRoles,
  AdminSessionGuard,
  type AuthenticatedAdmin,
  CurrentAdmin,
} from '../admin-auth/admin-session.guard';
import { AUDIT_READER, type AuditReader } from '../audit/drizzle-audit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AccountService } from './account.service';
import { TeamService } from './team.service';

const idParam = z.uuid();

@Controller('admin/team')
@UseGuards(AdminSessionGuard)
@AdminRoles('owner')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  async list(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminTeamResponse> {
    void reply.header('cache-control', 'no-store');
    return this.team.list(admin.account);
  }

  @Post('invites')
  async invite(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body(new ZodValidationPipe(adminInviteRequest)) body: AdminInviteRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminInviteCreatedResponse> {
    void reply.status(201).header('cache-control', 'no-store');
    return this.team.invite(admin.account, body, request.ip);
  }

  @Delete('invites/:inviteId')
  @HttpCode(204)
  async revokeInvite(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('inviteId', new ZodValidationPipe(idParam)) inviteId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.team.revokeInvite(admin.account, inviteId, request.ip);
  }

  @Patch(':adminId/role')
  @HttpCode(204)
  async changeRole(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('adminId', new ZodValidationPipe(idParam)) adminId: string,
    @Body(new ZodValidationPipe(adminRoleChangeRequest)) body: AdminRoleChangeRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.team.changeRole(admin.account, adminId, body.role, request.ip);
  }

  @Post(':adminId/mfa-reset')
  @HttpCode(204)
  async resetMfa(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('adminId', new ZodValidationPipe(idParam)) adminId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.team.resetMfa(admin.account, adminId, request.ip);
  }

  @Delete(':adminId')
  @HttpCode(204)
  async remove(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('adminId', new ZodValidationPipe(idParam)) adminId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.team.remove(admin.account, adminId, request.ip);
  }
}

/** Oturumu olmayan davetli için. Token adres çubuğunda değil gövdede gelir. */
@Controller('admin/invites')
export class InvitesController {
  constructor(private readonly team: TeamService) {}

  @Post('lookup')
  @HttpCode(200)
  async lookup(
    @Body(new ZodValidationPipe(adminInviteLookupRequest)) body: AdminInviteLookupRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminInviteLookupResponse> {
    void reply.header('cache-control', 'no-store');
    return this.team.lookupInvite(body.token, request.ip);
  }

  @Post('accept')
  @HttpCode(201)
  async accept(
    @Body(new ZodValidationPipe(adminInviteAcceptRequest)) body: AdminInviteAcceptRequest,
    @Req() request: FastifyRequest,
  ): Promise<{ email: string }> {
    return this.team.acceptInvite(body.token, body.password, request.ip);
  }
}

@Controller('admin/account')
@UseGuards(AdminSessionGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body(new ZodValidationPipe(adminPasswordChangeRequest)) body: AdminPasswordChangeRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = await this.account.changePassword(
      admin.account,
      admin.sessionToken,
      body.currentPassword,
      body.newPassword,
      request.ip,
    );
    void reply.setCookie(ADMIN_SESSION_COOKIE_NAME, token, adminCookieOptions('/admin'));
  }

  @Post('sessions/revoke-others')
  @HttpCode(204)
  async revokeOthers(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = await this.account.revokeOtherSessions(admin.account, admin.sessionToken, request.ip);
    void reply.setCookie(ADMIN_SESSION_COOKIE_NAME, token, adminCookieOptions('/admin'));
  }
}

/** Denetim kaydı yalnızca sahip rolüne açık; kayıt platformun kendi zinciriyle sınırlı. */
@Controller('admin/audit')
@UseGuards(AdminSessionGuard)
@AdminRoles('owner')
export class AuditController {
  constructor(@Inject(AUDIT_READER) private readonly audit: AuditReader) {}

  @Get()
  async list(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query(new ZodValidationPipe(auditListQuery)) query: AuditListQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuditListResponse> {
    void reply.header('cache-control', 'no-store');
    const events = await this.audit.list(admin.account.tenantId, query.before, query.limit + 1);
    const page = events.slice(0, query.limit);
    return { events: page, nextBefore: events.length > query.limit ? (page.at(-1)?.seq ?? null) : null };
  }

  @Get('verify')
  async verify(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuditVerifyResponse> {
    void reply.header('cache-control', 'no-store');
    return this.audit.verify(admin.account.tenantId);
  }
}
