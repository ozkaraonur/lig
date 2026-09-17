import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { leaderboardQuery, leagueIdParam, type LeaderboardView } from '@lig/shared';
import type { FastifyReply } from 'fastify';
import { PlayerRateLimit, PlayerRateLimitGuard, RATE_LIMITS } from '../auth/player-rate-limit.guard';
import { type AuthenticatedSession, CurrentSession, SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RankingService } from './ranking.service';

@Controller('leagues/:leagueId')
@UseGuards(SessionGuard, PlayerRateLimitGuard)
@PlayerRateLimit(RATE_LIMITS.leagueRead)
export class RankingController {
  constructor(private readonly ranking: RankingService) {}

  /** FR-06 */
  @Get('leaderboard')
  async leaderboard(
    @CurrentSession() session: AuthenticatedSession,
    @Param('leagueId', new ZodValidationPipe(leagueIdParam)) leagueId: string,
    @Query(new ZodValidationPipe(leaderboardQuery)) query: { limit: number },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ leaderboard: LeaderboardView }> {
    void reply.header('cache-control', 'no-store');
    return { leaderboard: await this.ranking.leaderboard(session, leagueId, query.limit) };
  }
}
