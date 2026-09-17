import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  type CreateSessionRequest,
  createSessionRequest,
  type MeResponse,
  type PublicPlayer,
  SESSION_COOKIE_NAME,
} from '@lig/shared';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { type AuthenticatedSession, CurrentSession, SessionGuard } from './session.guard';

/**
 * Çerez ayarları (T1):
 * - HttpOnly: sayfadaki JavaScript çerezi okuyamaz, XSS ile çalınamaz.
 * - Secure: sadece HTTPS üzerinden gider (tarayıcılar localhost'u istisna tutar).
 * - SameSite=Strict: başka bir siteden tetiklenen isteklere eklenmez (CSRF).
 */
export function sessionCookieOptions(maxAgeSeconds?: number): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    ...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds }),
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Platform token'ını oturum çerezine çevirir (FR-01). */
  @Post('session')
  @HttpCode(200)
  async createSession(
    @Body(new ZodValidationPipe(createSessionRequest)) body: CreateSessionRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ player: PublicPlayer }> {
    const session = await this.auth.createSession(body.token, request.ip);
    void reply
      .header('cache-control', 'no-store')
      .setCookie(SESSION_COOKIE_NAME, session.sessionToken, sessionCookieOptions(session.ttlSeconds));
    return { player: session.player };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  async me(
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse> {
    void reply.header('cache-control', 'no-store');
    return this.auth.me(session);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(session.token);
    void reply.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
  }
}
