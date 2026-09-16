import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';

export const REDIS = Symbol('REDIS');

function createRedis(env: Env): Redis {
  const logger = new Logger('Redis');
  const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  // Without a listener ioredis prints every reconnect failure as an unhandled error.
  // Only the message is logged: the connection string may contain a password.
  client.on('error', (err: Error) => logger.warn(`Redis connection error: ${err.message}`));
  return client;
}

@Global()
@Module({
  providers: [{ provide: REDIS, inject: [ENV], useFactory: createRedis }],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
