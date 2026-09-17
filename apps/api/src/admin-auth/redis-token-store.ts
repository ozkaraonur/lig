import { createHash, randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { type z } from 'zod';
import { type TokenStore } from './ports';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Token'ın kendisi değil SHA-256 özeti anahtar olur: Redis içeriği sızsa bile oturum çalınamaz.
 * Okunan veri şemayla doğrulanır; beklenmeyen biçim oturum yok sayılır.
 */
export class RedisTokenStore<T> implements TokenStore<T> {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly schema: z.ZodType<T>,
  ) {}

  private key(token: string): string {
    return `${this.prefix}:${createHash('sha256').update(token).digest('hex')}`;
  }

  async create(data: T, ttlSeconds: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(this.key(token), JSON.stringify(data), 'EX', ttlSeconds);
    return token;
  }

  async get(token: string): Promise<T | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const raw = await this.redis.get(this.key(token));
    if (!raw) return null;
    try {
      const parsed = this.schema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async replace(token: string, data: T): Promise<boolean> {
    if (!TOKEN_PATTERN.test(token)) return false;
    const result = await this.redis.set(this.key(token), JSON.stringify(data), 'KEEPTTL', 'XX');
    return result === 'OK';
  }

  async touch(token: string, ttlSeconds: number): Promise<void> {
    if (!TOKEN_PATTERN.test(token)) return;
    await this.redis.expire(this.key(token), ttlSeconds);
  }

  async destroy(token: string): Promise<void> {
    if (!TOKEN_PATTERN.test(token)) return;
    await this.redis.del(this.key(token));
  }
}
