import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import {
  type RateLimiter,
  type RateLimitResult,
  type ReplayStore,
  type SessionData,
  type SessionStore,
} from './ports';

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Token'ın kendisi değil SHA-256 özeti anahtar olur: Redis içeriği sızsa bile oturum çalınamaz. */
export function sessionKey(token: string): string {
  return `session:${createHash('sha256').update(token).digest('hex')}`;
}

@Injectable()
export class RedisReplayStore implements ReplayStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async markUsed(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }
}

@Injectable()
export class RedisSessionStore implements SessionStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async create(data: SessionData, ttlSeconds: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(sessionKey(token), JSON.stringify(data), 'EX', ttlSeconds);
    return token;
  }

  async get(token: string): Promise<SessionData | null> {
    if (!SESSION_TOKEN_PATTERN.test(token)) return null;
    const raw = await this.redis.get(sessionKey(token));
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as Partial<SessionData>;
      if (typeof data.playerId !== 'string' || typeof data.tenantId !== 'string') return null;
      return { playerId: data.playerId, tenantId: data.tenantId, createdAt: Number(data.createdAt) };
    } catch {
      return null;
    }
  }

  async destroy(token: string): Promise<void> {
    if (!SESSION_TOKEN_PATTERN.test(token)) return;
    await this.redis.del(sessionKey(token));
  }
}

/** Sabit pencereli sayaç: pencere içinde `limit`'ten fazla istek reddedilir. */
@Injectable()
export class RedisRateLimiter implements RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const results = await this.redis.multi().incr(key).expire(key, windowSeconds, 'NX').ttl(key).exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    const ttl = Number(results?.[2]?.[1] ?? windowSeconds);
    return { allowed: count <= limit, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
  }
}
