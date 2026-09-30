import { Body, Controller, HttpCode, Inject, Post, Res, UseGuards } from '@nestjs/common';
import {
  type CreateFriendsLeagueRequest,
  createFriendsLeagueRequest,
  type FriendsLeagueResponse,
  type JoinByCodeRequest,
  joinByCodeRequest,
} from '@lig/shared';
import type { FastifyReply } from 'fastify';
import { PlayerRateLimit, PlayerRateLimitGuard, RATE_LIMITS } from '../auth/player-rate-limit.guard';
import { type AuthenticatedSession, CurrentSession, SessionGuard } from '../auth/session.guard';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DB, type Database } from '../db/db.module';
import { createFriendsLeague, joinByCode } from './friends-store';

/** Oyuncu kimliği ve tenant oturumdan gelir; gövdeden alınmaz. */
@Controller('friends')
@UseGuards(SessionGuard, PlayerRateLimitGuard)
export class FriendsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  /** FR-09: arkadaş ligi kur. Bakiye, kontenjan ve varlıklar sabit; istemci yalnızca ad ve süre seçer. */
  @Post('leagues')
  @PlayerRateLimit(RATE_LIMITS.friendsCreate)
  async create(
    @CurrentSession() session: AuthenticatedSession,
    @Body(new ZodValidationPipe(createFriendsLeagueRequest)) body: CreateFriendsLeagueRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<FriendsLeagueResponse> {
    void reply.status(201).header('cache-control', 'no-store');
    return createFriendsLeague(this.db, session.tenantId, session.playerId, body, new Date(this.clock()));
  }

  /** FR-09: davet koduyla katıl. Kod denemeleri oyuncu başına dakikada 10 ile sınırlı (T9). */
  @Post('join')
  @HttpCode(200)
  @PlayerRateLimit(RATE_LIMITS.friendsJoin)
  async join(
    @CurrentSession() session: AuthenticatedSession,
    @Body(new ZodValidationPipe(joinByCodeRequest)) body: JoinByCodeRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<FriendsLeagueResponse> {
    void reply.header('cache-control', 'no-store');
    const result = await joinByCode(
      this.db,
      session.tenantId,
      session.playerId,
      body.code,
      new Date(this.clock()),
    );
    if (result.created) void reply.status(201);
    return result;
  }
}
