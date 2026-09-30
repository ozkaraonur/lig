import { Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { type StreakView } from '@lig/shared';
import type { FastifyReply } from 'fastify';
import { PlayerRateLimit, PlayerRateLimitGuard, RATE_LIMITS } from '../auth/player-rate-limit.guard';
import { type AuthenticatedSession, CurrentSession, SessionGuard } from '../auth/session.guard';
import { StreakService } from './streak.service';

/** Oyuncu kimliği her zaman oturumdan gelir; istekten kimlik ya da gün alınmaz. */
@Controller('streak')
@UseGuards(SessionGuard, PlayerRateLimitGuard)
export class StreakController {
  constructor(private readonly streak: StreakService) {}

  @Get()
  @PlayerRateLimit(RATE_LIMITS.leagueRead)
  async get(
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ streak: StreakView }> {
    void reply.header('cache-control', 'no-store');
    return { streak: await this.streak.get(session.tenantId, session.playerId) };
  }

  /** Günlük seri: bugünü etkin gün sayar. Günde tek satır yazılır, tekrarı zararsızdır. */
  @Post('visit')
  @HttpCode(200)
  @PlayerRateLimit(RATE_LIMITS.profileWrite)
  async visit(
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ streak: StreakView }> {
    void reply.header('cache-control', 'no-store');
    return { streak: await this.streak.visit(session.tenantId, session.playerId) };
  }

  @Post('joker/activate')
  @HttpCode(200)
  @PlayerRateLimit(RATE_LIMITS.profileWrite)
  async activate(
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ streak: StreakView }> {
    void reply.header('cache-control', 'no-store');
    return { streak: await this.streak.activateJoker(session.tenantId, session.playerId) };
  }
}
