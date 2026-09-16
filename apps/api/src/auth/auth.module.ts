import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DrizzlePlayerRepository, DrizzleTenantDirectory } from './drizzle-adapters';
import { PlayerTokenVerifier } from './player-token.verifier';
import {
  CLOCK,
  PLAYER_REPOSITORY,
  RATE_LIMITER,
  REPLAY_STORE,
  SESSION_STORE,
  systemClock,
  TENANT_DIRECTORY,
} from './ports';
import { RedisRateLimiter, RedisReplayStore, RedisSessionStore } from './redis-adapters';
import { SessionGuard } from './session.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PlayerTokenVerifier,
    SessionGuard,
    { provide: CLOCK, useValue: systemClock },
    { provide: TENANT_DIRECTORY, useClass: DrizzleTenantDirectory },
    { provide: PLAYER_REPOSITORY, useClass: DrizzlePlayerRepository },
    { provide: REPLAY_STORE, useClass: RedisReplayStore },
    { provide: SESSION_STORE, useClass: RedisSessionStore },
    { provide: RATE_LIMITER, useClass: RedisRateLimiter },
  ],
  exports: [SessionGuard, SESSION_STORE, CLOCK],
})
export class AuthModule {}
