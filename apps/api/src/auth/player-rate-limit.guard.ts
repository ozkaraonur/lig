import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError, unauthenticated } from '../common/app-error';
import { RATE_LIMITER, type RateLimiter } from './ports';

export interface RateLimitPolicy {
  /** Sayaç adı; aynı adı paylaşan uçlar aynı kotayı kullanır. */
  name: string;
  limit: number;
  windowSeconds: number;
}

/** Oyuncu başına istek sınırları (T9). Ekran fiyatları 2 sn'de bir yeniler: dakikada 30 okuma yalnızca bundan. */
export const RATE_LIMITS = {
  leagueRead: { name: 'league-read', limit: 120, windowSeconds: 60 },
  join: { name: 'join', limit: 10, windowSeconds: 60 },
  orders: { name: 'orders', limit: 30, windowSeconds: 60 },
  realTradeClick: { name: 'real-trade-click', limit: 20, windowSeconds: 60 },
  profileWrite: { name: 'profile-write', limit: 20, windowSeconds: 60 },
  friendsCreate: { name: 'friends-create', limit: 5, windowSeconds: 60 },
  friendsJoin: { name: 'friends-join', limit: 10, windowSeconds: 60 },
} satisfies Record<string, RateLimitPolicy>;

const RATE_LIMIT_METADATA = 'lig:rate-limit-policy';

export const PlayerRateLimit = (policy: RateLimitPolicy) => SetMetadata(RATE_LIMIT_METADATA, policy);

/**
 * SessionGuard'dan sonra çalışır. Sayaç oyuncu kimliğine bağlıdır, IP'ye değil: aynı mobil operatör
 * NAT'ı arkasındaki oyuncular birbirinin kotasını tüketmez.
 */
@Injectable()
export class PlayerRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<RateLimitPolicy | undefined>(RATE_LIMIT_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy) return true;

    const session = context.switchToHttp().getRequest<FastifyRequest>().ligSession;
    if (!session) throw unauthenticated();

    const key = `rl:${policy.name}:${session.tenantId}:${session.playerId}`;
    const result = await this.limiter.hit(key, policy.limit, policy.windowSeconds);
    if (!result.allowed) {
      throw new AppError('RATE_LIMITED', 429, 'Çok hızlı istek gönderiyorsun. Biraz bekleyip tekrar dene.', {
        'retry-after': String(result.retryAfterSeconds),
      });
    }
    return true;
  }
}
