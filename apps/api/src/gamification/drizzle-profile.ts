import { Inject, Injectable } from '@nestjs/common';
import { type BadgeId } from '@lig/shared';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { playerBadges, players } from '../db/schema';
import {
  type AppearanceChange,
  type AppearanceReader,
  type PlayerAppearance,
  type ProfileRepository,
  type StoredProfile,
} from './ports';

@Injectable()
export class DrizzleProfileRepository implements ProfileRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async find(tenantId: string, playerId: string): Promise<StoredProfile | null> {
    const [player] = await this.db
      .select({ xp: players.xp, selectedTitle: players.selectedTitle, selectedFrame: players.selectedFrame })
      .from(players)
      .where(and(eq(players.id, playerId), eq(players.tenantId, tenantId)));
    if (!player) return null;
    const badges = await this.db
      .select({ badgeId: playerBadges.badgeId, earnedAt: playerBadges.earnedAt })
      .from(playerBadges)
      .where(eq(playerBadges.playerId, playerId));
    // Şemadaki CHECK kısıtı rozet kimliğini kataloğa bağlıyor; tip daraltma güvenli.
    return { ...player, badges: badges as Array<{ badgeId: BadgeId; earnedAt: Date }> };
  }

  async setAppearance(tenantId: string, playerId: string, change: AppearanceChange): Promise<boolean> {
    const set: Partial<{ selectedTitle: string | null; selectedFrame: string | null }> = {};
    const conditions = [eq(players.id, playerId), eq(players.tenantId, tenantId)];

    if (change.title !== undefined) {
      set.selectedTitle = change.title?.id ?? null;
      // Unvan XP eşiğinden türetilir: eşiğe ulaşmamış oyuncu seçemez.
      if (change.title) conditions.push(gte(players.xp, change.title.minXp));
    }
    if (change.frame !== undefined) {
      set.selectedFrame = change.frame?.id ?? null;
      if (change.frame) {
        // Sahiplik güncellemenin içinde sınanır: okuyup sonra yazmak yerine tek atomik ifade.
        conditions.push(
          sql`exists (select 1 from player_badges pb where pb.player_id = ${players.id} and pb.badge_id = ${change.frame.badgeId})`,
        );
      }
    }

    const rows = await this.db
      .update(players)
      .set(set)
      .where(and(...conditions))
      .returning({ id: players.id });
    return rows.length === 1;
  }
}

@Injectable()
export class DrizzleAppearanceReader implements AppearanceReader {
  constructor(@Inject(DB) private readonly db: Database) {}

  async find(tenantId: string, playerIds: string[]): Promise<Map<string, PlayerAppearance>> {
    if (playerIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: players.id,
        xp: players.xp,
        selectedTitle: players.selectedTitle,
        selectedFrame: players.selectedFrame,
      })
      .from(players)
      .where(and(eq(players.tenantId, tenantId), inArray(players.id, playerIds)));
    return new Map(rows.map((r) => [r.id, r]));
  }
}
