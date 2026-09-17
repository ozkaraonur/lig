import { DEFAULT_PRIMARY_COLOR } from '@lig/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { PLAYER_TOKEN_AUDIENCE } from '@lig/shared';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import {
  type Clock,
  type PlayerRecord,
  type PlayerRepository,
  type RateLimiter,
  type RateLimitResult,
  type ReplayStore,
  type SessionData,
  type SessionStore,
  type TenantDirectory,
  type TenantKey,
} from './ports';

export const NOW = 1_800_000_000;
export const fixedClock: Clock = () => NOW;

export class InMemoryTenantDirectory implements TenantDirectory {
  constructor(private readonly tenants: TenantKey[]) {}
  async findByIssuer(issuer: string): Promise<TenantKey | null> {
    return this.tenants.find((t) => t.issuer === issuer) ?? null;
  }
  async findPublicInfo(tenantId: string) {
    return this.tenants.some((t) => t.tenantId === tenantId)
      ? {
          name: 'Test Platform',
          realTradeUrl: 'https://platform.test/trade',
          branding: { primaryColor: DEFAULT_PRIMARY_COLOR, logoUrl: null },
        }
      : null;
  }
}

export class InMemoryReplayStore implements ReplayStore {
  readonly used = new Map<string, number>();
  async markUsed(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.used.has(key)) return false;
    this.used.set(key, ttlSeconds);
    return true;
  }
}

export class InMemorySessionStore implements SessionStore {
  readonly sessions = new Map<string, SessionData>();
  async create(data: SessionData): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, data);
    return token;
  }
  async get(token: string): Promise<SessionData | null> {
    return this.sessions.get(token) ?? null;
  }
  async destroy(token: string): Promise<void> {
    this.sessions.delete(token);
  }
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, number>();
  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { allowed: count <= limit, retryAfterSeconds: windowSeconds };
  }
}

export class InMemoryPlayerRepository implements PlayerRepository {
  readonly players = new Map<string, PlayerRecord & { externalId: string }>();
  async upsert(tenantId: string, externalId: string, displayName: string): Promise<PlayerRecord> {
    const existing = [...this.players.values()].find(
      (p) => p.tenantId === tenantId && p.externalId === externalId,
    );
    const record = {
      id: existing?.id ?? randomUUID(),
      tenantId,
      externalId,
      displayName,
      xp: existing?.xp ?? 0,
    };
    this.players.set(record.id, record);
    return { id: record.id, tenantId, displayName, xp: record.xp };
  }
  async findById(tenantId: string, playerId: string): Promise<PlayerRecord | null> {
    const p = this.players.get(playerId);
    return p && p.tenantId === tenantId
      ? { id: p.id, tenantId: p.tenantId, displayName: p.displayName, xp: p.xp }
      : null;
  }
}

export interface TestPlatform {
  tenant: TenantKey;
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  sign(overrides?: TokenOverrides): Promise<string>;
}

export interface TokenOverrides {
  sub?: string;
  name?: string;
  jti?: string | null;
  iss?: string;
  aud?: string;
  iat?: number;
  exp?: number;
}

/** Testlerde gerçek RS256 anahtarlarıyla token üreten sahte platform. */
export async function createTestPlatform(tenantId: string, issuer: string): Promise<TestPlatform> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const publicKeyPem = await exportSPKI(publicKey);
  const tenant = { tenantId, issuer, publicKeyPem };

  return {
    tenant,
    privateKey,
    async sign(o: TokenOverrides = {}) {
      const jwt = new SignJWT(o.name === undefined ? {} : { name: o.name })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuer(o.iss ?? issuer)
        .setAudience(o.aud ?? PLAYER_TOKEN_AUDIENCE)
        .setSubject(o.sub ?? 'oyuncu-1')
        .setIssuedAt(o.iat ?? NOW)
        .setExpirationTime(o.exp ?? (o.iat ?? NOW) + 300);
      if (o.jti !== null) jwt.setJti(o.jti ?? randomUUID());
      return jwt.sign(privateKey);
    },
  };
}
