import { Inject, Injectable } from '@nestjs/common';
import { type MeResponse, type PublicPlayer } from '@lig/shared';
import { AppError, unauthenticated } from '../common/app-error';
import { PlayerTokenVerifier } from './player-token.verifier';
import {
  CLOCK,
  type Clock,
  PLAYER_REPOSITORY,
  type PlayerRepository,
  RATE_LIMITER,
  type RateLimiter,
  SESSION_STORE,
  type SessionData,
  type SessionStore,
  TENANT_DIRECTORY,
  type TenantDirectory,
  type PlayerRecord,
} from './ports';

/** Oturum süresi. Süre dolunca oyuncu platform uygulamasından yeniden açar. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

/** Bir IP adresinden dakikada en fazla bu kadar giriş denemesi (T9). */
export const LOGIN_RATE_LIMIT = { limit: 20, windowSeconds: 60 };

export interface CreatedSession {
  sessionToken: string;
  ttlSeconds: number;
  player: PublicPlayer;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly verifier: PlayerTokenVerifier,
    @Inject(PLAYER_REPOSITORY) private readonly playerRepository: PlayerRepository,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TENANT_DIRECTORY) private readonly tenants: TenantDirectory,
  ) {}

  async createSession(playerToken: string, clientIp: string): Promise<CreatedSession> {
    const { limit, windowSeconds } = LOGIN_RATE_LIMIT;
    const rate = await this.rateLimiter.hit(`rl:auth-session:${clientIp}`, limit, windowSeconds);
    if (!rate.allowed) {
      throw new AppError('RATE_LIMITED', 429, 'Çok fazla giriş denemesi. Biraz sonra tekrar dene.', {
        'retry-after': String(rate.retryAfterSeconds),
      });
    }

    const verified = await this.verifier.verify(playerToken);
    const player = await this.playerRepository.upsert(
      verified.tenantId,
      verified.externalId,
      verified.displayName,
    );
    const sessionToken = await this.sessions.create(
      { playerId: player.id, tenantId: player.tenantId, createdAt: this.clock() },
      SESSION_TTL_SECONDS,
    );

    return {
      sessionToken,
      ttlSeconds: SESSION_TTL_SECONDS,
      player: toPublicPlayer(player),
    };
  }

  async me(session: SessionData): Promise<MeResponse> {
    const [player, platform] = await Promise.all([
      this.playerRepository.findById(session.tenantId, session.playerId),
      this.tenants.findPublicInfo(session.tenantId),
    ]);
    if (!player || !platform) throw unauthenticated();
    return { player: toPublicPlayer(player), platform };
  }

  async logout(sessionToken: string): Promise<void> {
    await this.sessions.destroy(sessionToken);
  }
}

function toPublicPlayer(player: PlayerRecord): PublicPlayer {
  return { id: player.id, displayName: player.displayName, xp: player.xp };
}
