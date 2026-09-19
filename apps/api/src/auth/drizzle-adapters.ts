import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_PRIMARY_COLOR, DEFAULT_THEME_MODE, type ThemeMode } from '@lig/shared';
import { and, eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { players, tenants } from '../db/schema';
import {
  type PlayerRecord,
  type PlayerRepository,
  type TenantDirectory,
  type TenantKey,
  type TenantPublicInfo,
} from './ports';

@Injectable()
export class DrizzleTenantDirectory implements TenantDirectory {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findByIssuer(issuer: string): Promise<TenantKey | null> {
    const [row] = await this.db
      .select({ id: tenants.id, issuer: tenants.ssoIssuer, publicKeyPem: tenants.ssoPublicKey })
      .from(tenants)
      .where(eq(tenants.ssoIssuer, issuer))
      .limit(1);
    if (!row?.issuer || !row.publicKeyPem) return null;
    return { tenantId: row.id, issuer: row.issuer, publicKeyPem: row.publicKeyPem };
  }

  async findPublicInfo(tenantId: string): Promise<TenantPublicInfo | null> {
    const [row] = await this.db
      .select({
        name: tenants.name,
        realTradeUrl: tenants.realTradeUrl,
        realTradeButtonEnabled: tenants.realTradeButtonEnabled,
        theme: tenants.theme,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!row) return null;
    // Uyum ayarı kapalıysa (FR-24) adres oyuncuya hiç gönderilmez; buton da görünmez.
    const theme = (row.theme ?? {}) as {
      primaryColor?: string;
      logoUrl?: string | null;
      themeMode?: string;
    };
    const themeMode: ThemeMode =
      theme.themeMode === 'light' || theme.themeMode === 'dark' ? theme.themeMode : DEFAULT_THEME_MODE;
    return {
      name: row.name,
      realTradeUrl: row.realTradeButtonEnabled ? safeHttpUrl(row.realTradeUrl) : null,
      branding: {
        primaryColor: theme.primaryColor ?? DEFAULT_PRIMARY_COLOR,
        // Kayıt elle bozulmuş olsa bile oyuncu ekranına yalnızca https adresi gider.
        logoUrl: theme.logoUrl?.startsWith('https://') ? theme.logoUrl : null,
        themeMode,
      },
    };
  }
}

/**
 * Yalnızca http(s) adresleri istemciye verilir. Adres ileride yönetici panelinden girilecek (FR-22);
 * "javascript:" gibi bir değer butona konursa tıklayan oyuncunun oturumunda kod çalışırdı (XSS).
 */
export function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

@Injectable()
export class DrizzlePlayerRepository implements PlayerRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async upsert(tenantId: string, externalId: string, displayName: string): Promise<PlayerRecord> {
    const [row] = await this.db
      .insert(players)
      .values({ tenantId, externalId, displayName })
      .onConflictDoUpdate({ target: [players.tenantId, players.externalId], set: { displayName } })
      .returning({
        id: players.id,
        tenantId: players.tenantId,
        displayName: players.displayName,
        xp: players.xp,
      });
    if (!row) throw new Error('Player upsert returned no row');
    return row;
  }

  /** Oyuncu her zaman tenant ile birlikte aranır: başka platformun oyuncusu asla dönmez (T4). */
  async findById(tenantId: string, playerId: string): Promise<PlayerRecord | null> {
    const [row] = await this.db
      .select({
        id: players.id,
        tenantId: players.tenantId,
        displayName: players.displayName,
        xp: players.xp,
      })
      .from(players)
      .where(and(eq(players.id, playerId), eq(players.tenantId, tenantId)))
      .limit(1);
    return row ?? null;
  }
}
