import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MAX_PLAYER_TOKEN_TTL_SECONDS,
  PLAYER_TOKEN_ALGORITHM,
  PLAYER_TOKEN_AUDIENCE,
  playerTokenClaims,
} from '@lig/shared';
import { decodeJwt, decodeProtectedHeader, errors, importSPKI, jwtVerify } from 'jose';
import { invalidToken } from '../common/app-error';
import {
  CLOCK,
  type Clock,
  REPLAY_STORE,
  type ReplayStore,
  TENANT_DIRECTORY,
  type TenantDirectory,
  type TenantKey,
} from './ports';

/** Platform ile bizim saatimiz arasında kabul edilen en fazla fark. */
export const CLOCK_TOLERANCE_SECONDS = 5;

export interface VerifiedPlayer {
  tenantId: string;
  externalId: string;
  displayName: string;
}

type VerificationKey = Awaited<ReturnType<typeof importSPKI>>;

/**
 * Platformun imzaladığı oyuncu token'ını doğrular (FR-01, T1).
 *
 * Sıra önemlidir:
 * 1. Başlıktaki algoritma RS256 değilse imzaya bakılmadan reddedilir (`none`, HS256 anahtar karışıklığı).
 * 2. `iss` ile platform bulunur; token sadece o platformun açık anahtarıyla doğrulanır.
 * 3. İmza, `aud`, `iss`, `exp`, `iat` doğrulanır; ömür 5 dakikayı geçemez.
 * 4. `jti` tek kullanımlıktır: aynı token ikinci kez gelirse reddedilir.
 *
 * Hangi adımın düştüğü istemciye söylenmez, sadece sunucu loguna yazılır. Token'ın kendisi asla loglanmaz.
 */
@Injectable()
export class PlayerTokenVerifier {
  private readonly logger = new Logger(PlayerTokenVerifier.name);
  private readonly keyCache = new Map<string, { pem: string; key: VerificationKey }>();

  constructor(
    @Inject(TENANT_DIRECTORY) private readonly directory: TenantDirectory,
    @Inject(REPLAY_STORE) private readonly replayStore: ReplayStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async verify(token: string): Promise<VerifiedPlayer> {
    let alg: unknown;
    let unverifiedIssuer: unknown;
    try {
      alg = decodeProtectedHeader(token).alg;
      unverifiedIssuer = decodeJwt(token).iss;
    } catch {
      return this.reject('malformed');
    }

    if (alg !== PLAYER_TOKEN_ALGORITHM) return this.reject('unsupported_alg');
    if (
      typeof unverifiedIssuer !== 'string' ||
      unverifiedIssuer.length === 0 ||
      unverifiedIssuer.length > 256
    ) {
      return this.reject('missing_issuer');
    }

    const tenant = await this.directory.findByIssuer(unverifiedIssuer);
    if (!tenant) return this.reject('unknown_issuer');

    const key = await this.keyFor(tenant);
    if (!key) return this.reject('invalid_tenant_key');

    const now = this.clock();
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, key, {
        algorithms: [PLAYER_TOKEN_ALGORITHM],
        issuer: tenant.issuer,
        audience: PLAYER_TOKEN_AUDIENCE,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: new Date(now * 1000),
        requiredClaims: ['iat', 'exp', 'jti', 'sub'],
      }));
    } catch (err) {
      return this.reject(err instanceof errors.JOSEError ? err.code : 'verification_failed');
    }

    const parsed = playerTokenClaims.safeParse(payload);
    if (!parsed.success) return this.reject('invalid_claims');
    const { iat, exp, jti, sub, name } = parsed.data;

    if (iat > now + CLOCK_TOLERANCE_SECONDS) return this.reject('issued_in_future');
    if (exp - iat > MAX_PLAYER_TOKEN_TTL_SECONDS) return this.reject('lifetime_too_long');

    const replayTtl = Math.max(1, exp - now + CLOCK_TOLERANCE_SECONDS);
    const firstUse = await this.replayStore.markUsed(`jti:${tenant.tenantId}:${jti}`, replayTtl);
    if (!firstUse) return this.reject('replayed');

    return {
      tenantId: tenant.tenantId,
      externalId: sub,
      displayName: name ?? `Oyuncu ${sub.slice(-4)}`,
    };
  }

  private async keyFor(tenant: TenantKey): Promise<VerificationKey | null> {
    const cached = this.keyCache.get(tenant.tenantId);
    if (cached && cached.pem === tenant.publicKeyPem) return cached.key;
    try {
      const key = await importSPKI(tenant.publicKeyPem, PLAYER_TOKEN_ALGORITHM);
      this.keyCache.set(tenant.tenantId, { pem: tenant.publicKeyPem, key });
      return key;
    } catch {
      return null;
    }
  }

  private reject(reason: string): never {
    this.logger.warn(`Player token rejected: ${reason}`);
    throw invalidToken();
  }
}
