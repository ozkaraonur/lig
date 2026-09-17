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
  type AdminQuestView,
  type BrandingUpdateRequest,
  brandingUpdateRequest,
  type BrandingView,
  type CreateQuestRequest,
  createQuestRequest,
  leagueIdParam,
  type UpdateQuestRequest,
  updateQuestRequest,
} from '@lig/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AdminRoles,
  AdminSessionGuard,
  type AuthenticatedAdmin,
  CurrentAdmin,
} from '../admin-auth/admin-session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminSettingsService } from './admin-settings.service';

/** FR-21. Her rol görür; sahip ve düzenleyici değiştirir. */
@Controller('admin/quests')
@UseGuards(AdminSessionGuard)
export class AdminQuestsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  async list(@CurrentAdmin() admin: AuthenticatedAdmin, @Res({ passthrough: true }) reply: FastifyReply) {
    void reply.header('cache-control', 'no-store');
    return { quests: await this.settings.listQuests(admin.account) } satisfies { quests: AdminQuestView[] };
  }

  @Post()
  @HttpCode(201)
  @AdminRoles('owner', 'editor')
  async create(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body(new ZodValidationPipe(createQuestRequest)) body: CreateQuestRequest,
    @Req() request: FastifyRequest,
  ) {
    return { quest: await this.settings.createQuest(admin.account, body, request.ip) } satisfies {
      quest: AdminQuestView;
    };
  }

  @Patch(':questId')
  @AdminRoles('owner', 'editor')
  async update(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('questId', new ZodValidationPipe(leagueIdParam)) questId: string,
    @Body(new ZodValidationPipe(updateQuestRequest)) body: UpdateQuestRequest,
    @Req() request: FastifyRequest,
  ) {
    return { quest: await this.settings.updateQuest(admin.account, questId, body, request.ip) } satisfies {
      quest: AdminQuestView;
    };
  }

  @Delete(':questId')
  @HttpCode(204)
  @AdminRoles('owner', 'editor')
  async remove(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('questId', new ZodValidationPipe(leagueIdParam)) questId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.settings.deleteQuest(admin.account, questId, request.ip);
  }
}

/** FR-22. Oyuncu ekranının adı, rengi ve logosu. */
@Controller('admin/branding')
@UseGuards(AdminSessionGuard)
export class BrandingController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  async get(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BrandingView> {
    void reply.header('cache-control', 'no-store');
    return this.settings.getBranding(admin.account);
  }

  @Patch()
  @AdminRoles('owner', 'editor')
  update(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body(new ZodValidationPipe(brandingUpdateRequest)) body: BrandingUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<BrandingView> {
    return this.settings.updateBranding(admin.account, body, request.ip);
  }
}
