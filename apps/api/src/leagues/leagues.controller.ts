import { Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import {
  type JoinLeagueResponse,
  type LeaguePricesResponse,
  type LeagueDetail,
  leagueIdParam,
  type LeagueSummary,
} from '@lig/shared';
import type { FastifyReply } from 'fastify';
import { PlayerRateLimit, PlayerRateLimitGuard, RATE_LIMITS } from '../auth/player-rate-limit.guard';
import { type AuthenticatedSession, CurrentSession, SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LeaguesService } from './leagues.service';

/** Bütün lig uçları oturum ister ve oyuncunun tenant'ı ile sınırlıdır. Yanıtlar kişiye özel, önbelleğe alınmaz. */
@Controller('leagues')
@UseGuards(SessionGuard, PlayerRateLimitGuard)
@PlayerRateLimit(RATE_LIMITS.leagueRead)
export class LeaguesController {
  constructor(private readonly leagues: LeaguesService) {}

  @Get()
  async list(
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ leagues: LeagueSummary[] }> {
    void reply.header('cache-control', 'no-store');
    return { leagues: await this.leagues.list(session) };
  }

  @Get(':leagueId')
  async get(
    @CurrentSession() session: AuthenticatedSession,
    @Param('leagueId', new ZodValidationPipe(leagueIdParam)) leagueId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ league: LeagueDetail }> {
    void reply.header('cache-control', 'no-store');
    return { league: await this.leagues.get(session, leagueId) };
  }

  @Get(':leagueId/prices')
  async prices(
    @CurrentSession() session: AuthenticatedSession,
    @Param('leagueId', new ZodValidationPipe(leagueIdParam)) leagueId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LeaguePricesResponse> {
    void reply.header('cache-control', 'no-store');
    return this.leagues.latestPrices(session, leagueId);
  }

  /** İlk katılımda 201, zaten üyeyse 200 ve mevcut üyelik. Gövde almaz: bakiye istemciden gelmez. */
  @Post(':leagueId/join')
  @PlayerRateLimit(RATE_LIMITS.join)
  async join(
    @CurrentSession() session: AuthenticatedSession,
    @Param('leagueId', new ZodValidationPipe(leagueIdParam)) leagueId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<JoinLeagueResponse> {
    const result = await this.leagues.join(session, leagueId);
    void reply.status(result.created ? 201 : 200).header('cache-control', 'no-store');
    return result;
  }
}
