import { Controller, Headers, HttpCode, Post, type RawBodyRequest, Req } from '@nestjs/common';
import { WEBHOOK_HEADERS } from '@lig/shared';
import type { FastifyRequest } from 'fastify';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /** FR-31: platform → lig. Oturum çerezi değil HMAC imzası ile doğrulanır. */
  @Post('platform')
  @HttpCode(202)
  async platform(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers(WEBHOOK_HEADERS.issuer) issuer?: string,
    @Headers(WEBHOOK_HEADERS.timestamp) timestamp?: string,
    @Headers(WEBHOOK_HEADERS.signature) signature?: string,
  ): Promise<{ received: true; duplicate: boolean }> {
    const result = await this.webhooks.receive({ issuer, timestamp, signature }, request.rawBody);
    return { received: true, duplicate: result.duplicate };
  }
}
