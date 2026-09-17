import { Controller, Get, Inject, Res, UseGuards } from '@nestjs/common';
import { type QuestView } from '@lig/shared';
import type { FastifyReply } from 'fastify';
import { PlayerRateLimit, PlayerRateLimitGuard, RATE_LIMITS } from '../auth/player-rate-limit.guard';
import { type AuthenticatedSession, CurrentSession, SessionGuard } from '../auth/session.guard';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { QuestsService } from './quest-evaluator';

@Controller('quests')
@UseGuards(SessionGuard, PlayerRateLimitGuard)
@PlayerRateLimit(RATE_LIMITS.leagueRead)
export class QuestsController {
  constructor(
    private readonly quests: QuestsService,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  /** FR-07: oyuncunun güncel görevleri ve ilerlemesi. */
  @Get()
  async list(
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ quests: QuestView[] }> {
    void reply.header('cache-control', 'no-store');
    return {
      quests: await this.quests.listForPlayer(session.tenantId, session.playerId, new Date(this.clock())),
    };
  }
}
