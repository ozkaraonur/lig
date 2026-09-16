import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { REDIS } from '../redis/redis.module';

export type CheckStatus = 'up' | 'down';

export interface HealthReport {
  status: CheckStatus;
  checks: { database: CheckStatus; redis: CheckStatus };
}

const TIMEOUT_MS = 1_500;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
  ]);
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pick<Pool, 'query'>,
    @Inject(REDIS) private readonly redis: Pick<Redis, 'ping'>,
  ) {}

  async check(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([
      withTimeout(this.pool.query('select 1')).then(
        () => 'up' as const,
        () => 'down' as const,
      ),
      withTimeout(this.redis.ping()).then(
        (r) => (r === 'PONG' ? ('up' as const) : ('down' as const)),
        () => 'down' as const,
      ),
    ]);
    return { status: database === 'up' && redis === 'up' ? 'up' : 'down', checks: { database, redis } };
  }
}
