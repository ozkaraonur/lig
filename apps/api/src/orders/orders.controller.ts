import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  leagueIdParam,
  orderHistoryQuery,
  type OrderView,
  type PlaceOrderRequest,
  placeOrderRequest,
  type PlaceOrderResponse,
  type PortfolioView,
} from '@lig/shared';
import type { FastifyReply } from 'fastify';
import { PlayerRateLimit, PlayerRateLimitGuard, RATE_LIMITS } from '../auth/player-rate-limit.guard';
import { type AuthenticatedSession, CurrentSession, SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OrdersService } from './orders.service';
import { PortfolioService } from './portfolio.service';

@Controller('leagues/:leagueId')
@UseGuards(SessionGuard, PlayerRateLimitGuard)
@PlayerRateLimit(RATE_LIMITS.leagueRead)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly portfolioService: PortfolioService,
  ) {}

  /** FR-04: yeni emirde 201, aynı idempotency anahtarıyla tekrarda 200 ve önceki sonuç (FR-33). */
  @Post('orders')
  @PlayerRateLimit(RATE_LIMITS.orders)
  async place(
    @CurrentSession() session: AuthenticatedSession,
    @Param('leagueId', new ZodValidationPipe(leagueIdParam)) leagueId: string,
    @Body(new ZodValidationPipe(placeOrderRequest)) body: PlaceOrderRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PlaceOrderResponse> {
    const result = await this.orders.place(session, leagueId, body);
    void reply.status(result.replayed ? 200 : 201).header('cache-control', 'no-store');
    return result;
  }

  @Get('orders')
  async history(
    @CurrentSession() session: AuthenticatedSession,
    @Param('leagueId', new ZodValidationPipe(leagueIdParam)) leagueId: string,
    @Query(new ZodValidationPipe(orderHistoryQuery)) query: { limit: number },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ orders: OrderView[] }> {
    void reply.header('cache-control', 'no-store');
    return { orders: await this.portfolioService.history(session, leagueId, query.limit) };
  }

  /** FR-05 */
  @Get('portfolio')
  async portfolio(
    @CurrentSession() session: AuthenticatedSession,
    @Param('leagueId', new ZodValidationPipe(leagueIdParam)) leagueId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ portfolio: PortfolioView }> {
    void reply.header('cache-control', 'no-store');
    return { portfolio: await this.portfolioService.portfolio(session, leagueId) };
  }
}
