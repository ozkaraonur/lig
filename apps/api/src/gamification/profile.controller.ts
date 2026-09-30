import { Body, Controller, Get, Put, Res, UseGuards } from '@nestjs/common';
import { type AppearanceRequest, appearanceRequest, type ProfileView } from '@lig/shared';
import type { FastifyReply } from 'fastify';
import { PlayerRateLimit, PlayerRateLimitGuard, RATE_LIMITS } from '../auth/player-rate-limit.guard';
import { type AuthenticatedSession, CurrentSession, SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProfileService } from './profile.service';

@Controller('profile')
@UseGuards(SessionGuard, PlayerRateLimitGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  /** FR-10: rozetler, unvanlar, çerçeveler. */
  @Get()
  @PlayerRateLimit(RATE_LIMITS.leagueRead)
  async get(
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ profile: ProfileView }> {
    void reply.header('cache-control', 'no-store');
    return { profile: await this.profile.get(session.tenantId, session.playerId) };
  }

  /** Unvan ve çerçeve seçimi. Yalnızca kendi profili: oyuncu kimliği oturumdan gelir, istekten değil. */
  @Put('appearance')
  @PlayerRateLimit(RATE_LIMITS.profileWrite)
  async setAppearance(
    @CurrentSession() session: AuthenticatedSession,
    @Body(new ZodValidationPipe(appearanceRequest)) body: AppearanceRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ profile: ProfileView }> {
    void reply.header('cache-control', 'no-store');
    return { profile: await this.profile.setAppearance(session.tenantId, session.playerId, body) };
  }
}
