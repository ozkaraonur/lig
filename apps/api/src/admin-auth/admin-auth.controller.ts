import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ADMIN_PREAUTH_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
  type AdminLoginRequest,
  adminLoginRequest,
  type AdminLoginResponse,
  type AdminMeResponse,
  type AdminMfaSetupResponse,
  type AdminMfaVerifyRequest,
  adminMfaVerifyRequest,
} from '@lig/shared';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminAuthService } from './admin-auth.service';
import { type AuthenticatedAdmin, AdminSessionGuard, CurrentAdmin } from './admin-session.guard';

/**
 * Çerezler oyuncu çerezindeki ayarlarla (HttpOnly, Secure, SameSite=Strict) ve dar yolla verilir:
 * giriş adımı çerezi yalnızca `/admin/auth`, oturum çerezi yalnızca `/admin` altına gider.
 * Oturum çerezine süre verilmez: tarayıcı kapanınca silinir. Sunucu tarafı süreler ayrıca uygulanır.
 */
export function adminCookieOptions(
  path: '/admin' | '/admin/auth',
  maxAgeSeconds?: number,
): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path,
    ...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds }),
  };
}

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(adminLoginRequest)) body: AdminLoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminLoginResponse> {
    const started = await this.auth.login(body, request.ip);
    void reply
      .header('cache-control', 'no-store')
      .setCookie(
        ADMIN_PREAUTH_COOKIE_NAME,
        started.preAuthToken,
        adminCookieOptions('/admin/auth', started.ttlSeconds),
      );
    return { next: started.next };
  }

  @Post('mfa/setup')
  @HttpCode(200)
  async mfaSetup(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminMfaSetupResponse> {
    void reply.header('cache-control', 'no-store');
    return this.auth.startMfaSetup(request.cookies?.[ADMIN_PREAUTH_COOKIE_NAME]);
  }

  @Post('mfa/verify')
  @HttpCode(200)
  async mfaVerify(
    @Body(new ZodValidationPipe(adminMfaVerifyRequest)) body: AdminMfaVerifyRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminMeResponse> {
    const completed = await this.auth.verifyMfa(request.cookies?.[ADMIN_PREAUTH_COOKIE_NAME], body.code);
    void reply
      .header('cache-control', 'no-store')
      .clearCookie(ADMIN_PREAUTH_COOKIE_NAME, adminCookieOptions('/admin/auth'))
      .setCookie(ADMIN_SESSION_COOKIE_NAME, completed.sessionToken, adminCookieOptions('/admin'));
    return completed.me;
  }

  @Get('me')
  @UseGuards(AdminSessionGuard)
  async me(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminMeResponse> {
    void reply.header('cache-control', 'no-store');
    return this.auth.me(admin.account);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AdminSessionGuard)
  async logout(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(admin.sessionToken);
    void reply.clearCookie(ADMIN_SESSION_COOKIE_NAME, adminCookieOptions('/admin'));
  }
}
