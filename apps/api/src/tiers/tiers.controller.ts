import { Controller, Get, HttpCode, Inject, Post, Res, UseGuards } from '@nestjs/common';
import { type TierView } from '@lig/shared';
import type { FastifyReply } from 'fastify';
import { PlayerRateLimit, PlayerRateLimitGuard, RATE_LIMITS } from '../auth/player-rate-limit.guard';
import { type AuthenticatedSession, CurrentSession, SessionGuard } from '../auth/session.guard';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { DB, type Database } from '../db/db.module';
import { joinTierLeague, type TierJoinResult, tierView } from './tiers-store';

/** Oyuncu kimliği ve tenant oturumdan gelir; kademe ve grup sunucuda belirlenir, istekten alınmaz. */
@Controller('tiers')
@UseGuards(SessionGuard, PlayerRateLimitGuard)
export class TiersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  /** Oyuncunun kademesi ve bu haftaki grubu. */
  @Get('me')
  @PlayerRateLimit(RATE_LIMITS.leagueRead)
  async me(
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ tier: TierView }> {
    void reply.header('cache-control', 'no-store');
    return { tier: await tierView(this.db, session.tenantId, session.playerId, new Date(this.clock())) };
  }

  /** Bu haftanın kademe grubuna katıl. İlk katılımda 201, zaten üyeyse 200. Gövde almaz. */
  @Post('join')
  @HttpCode(200)
  @PlayerRateLimit(RATE_LIMITS.join)
  async join(
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TierJoinResult> {
    const result = await joinTierLeague(this.db, session.tenantId, session.playerId, new Date(this.clock()));
    void reply.status(result.created ? 201 : 200).header('cache-control', 'no-store');
    return result;
  }
}
