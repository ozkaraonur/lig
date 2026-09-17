import { Body, Controller, Get, HttpCode, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  type MetricsQuery,
  metricsQuery,
  type MetricsResponse,
  type RealTradeClickRequest,
  realTradeClickRequest,
} from '@lig/shared';
import type { FastifyReply } from 'fastify';
import { AdminSessionGuard, type AuthenticatedAdmin, CurrentAdmin } from '../admin-auth/admin-session.guard';
import { PlayerRateLimit, PlayerRateLimitGuard, RATE_LIMITS } from '../auth/player-rate-limit.guard';
import { type AuthenticatedSession, CurrentSession, SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MetricsService } from './metrics.service';

/** FR-23. Her rol görür: metrik okumak bir değişiklik değil, izleyici de platformun gidişatını görebilmeli. */
@Controller('admin/metrics')
@UseGuards(AdminSessionGuard)
export class AdminMetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async report(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query(new ZodValidationPipe(metricsQuery)) query: MetricsQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MetricsResponse> {
    void reply.header('cache-control', 'no-store');
    return this.metrics.report(admin.account, query.days);
  }
}

/**
 * Oyuncu "Gerçek hesabıma geç"e dokunduğunda çağrılır (FR-23 huni ölçümü). Adres yanıtta dönmez;
 * oyuncu ekranı adresi zaten `/auth/me` ile almıştır ve uyum ayarı kapalıysa hiç almaz (K-022).
 */
@Controller('real-trade')
@UseGuards(SessionGuard, PlayerRateLimitGuard)
@PlayerRateLimit(RATE_LIMITS.realTradeClick)
export class RealTradeClickController {
  constructor(private readonly metrics: MetricsService) {}

  @Post('click')
  @HttpCode(204)
  async click(
    @CurrentSession() session: AuthenticatedSession,
    @Body(new ZodValidationPipe(realTradeClickRequest)) body: RealTradeClickRequest,
  ): Promise<void> {
    await this.metrics.recordClick(session.tenantId, session.playerId, body.leagueId ?? null);
  }
}
