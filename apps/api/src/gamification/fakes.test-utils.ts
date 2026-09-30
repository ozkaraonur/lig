import { type BadgeId } from '@lig/shared';
import { type AppearanceChange, type ProfileRepository, type StoredProfile } from './ports';

interface StoredPlayer {
  tenantId: string;
  xp: number;
  selectedTitle: string | null;
  selectedFrame: string | null;
  badges: Map<BadgeId, Date>;
}

/**
 * Drizzle deposunun kurallarını bellekte taklit eder. Kuralların SQL'de de aynı olduğu
 * gamification.int.test.ts ile gerçek veritabanında ayrıca sınanır.
 */
export class InMemoryProfileRepository implements ProfileRepository {
  readonly players = new Map<string, StoredPlayer>();
  /** Yazma çağrılarının kaydı: reddedilen seçimin hiçbir alanı yazmadığını görmek için. */
  writes = 0;

  addPlayer(id: string, tenantId: string, xp = 0, badges: BadgeId[] = []): void {
    this.players.set(id, {
      tenantId,
      xp,
      selectedTitle: null,
      selectedFrame: null,
      badges: new Map(badges.map((b) => [b, new Date('2027-01-12T10:00:00Z')])),
    });
  }

  async find(tenantId: string, playerId: string): Promise<StoredProfile | null> {
    const player = this.players.get(playerId);
    if (!player || player.tenantId !== tenantId) return null;
    return {
      xp: player.xp,
      selectedTitle: player.selectedTitle,
      selectedFrame: player.selectedFrame,
      badges: [...player.badges].map(([badgeId, earnedAt]) => ({ badgeId, earnedAt })),
    };
  }

  async setAppearance(tenantId: string, playerId: string, change: AppearanceChange): Promise<boolean> {
    const player = this.players.get(playerId);
    if (!player || player.tenantId !== tenantId) return false;
    if (change.title && player.xp < change.title.minXp) return false;
    if (change.frame && !player.badges.has(change.frame.badgeId)) return false;
    this.writes += 1;
    if (change.title !== undefined) player.selectedTitle = change.title?.id ?? null;
    if (change.frame !== undefined) player.selectedFrame = change.frame?.id ?? null;
    return true;
  }
}
