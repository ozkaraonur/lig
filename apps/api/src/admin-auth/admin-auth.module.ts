import { Module } from '@nestjs/common';
import type Redis from 'ioredis';
import { AuthModule } from '../auth/auth.module';
import { CLOCK_MS, systemClockMs } from '../common/clock';
import { REDIS } from '../redis/redis.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminSessionGuard } from './admin-session.guard';
import { DrizzleAdminRepository } from './drizzle-admin.repository';
import { ADMIN_PREAUTH_STORE, ADMIN_REPOSITORY, ADMIN_SESSION_STORE } from './ports';
import { RedisTokenStore } from './redis-token-store';
import { adminPreAuthData, adminSessionData } from './session-schemas';

@Module({
  imports: [AuthModule],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    AdminSessionGuard,
    { provide: CLOCK_MS, useValue: systemClockMs },
    { provide: ADMIN_REPOSITORY, useClass: DrizzleAdminRepository },
    {
      provide: ADMIN_SESSION_STORE,
      inject: [REDIS],
      useFactory: (redis: Redis) => new RedisTokenStore(redis, 'admin-session', adminSessionData),
    },
    {
      provide: ADMIN_PREAUTH_STORE,
      inject: [REDIS],
      useFactory: (redis: Redis) => new RedisTokenStore(redis, 'admin-preauth', adminPreAuthData),
    },
  ],
  exports: [AdminSessionGuard, ADMIN_REPOSITORY, ADMIN_SESSION_STORE, CLOCK_MS],
})
export class AdminAuthModule {}
