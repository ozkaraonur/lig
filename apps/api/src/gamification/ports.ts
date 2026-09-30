import { type BadgeId, type FrameId, type TitleId } from '@lig/shared';

export interface StoredProfile {
  xp: number;
  selectedTitle: string | null;
  selectedFrame: string | null;
  badges: Array<{ badgeId: BadgeId; earnedAt: Date }>;
}

/** Seçimde istenen değişiklik. Verilmeyen alan değişmez, `null` seçimi kaldırır. */
export interface AppearanceChange {
  title?: { id: TitleId; minXp: number } | null;
  frame?: { id: FrameId; badgeId: BadgeId } | null;
}

export interface ProfileRepository {
  /** Oyuncu bu tenant'ta yoksa null: başka tenant'ın oyuncusu "yok" ile aynı yanıtı alır (NFR-03). */
  find(tenantId: string, playerId: string): Promise<StoredProfile | null>;
  /**
   * Seçimi tek atomik güncellemeyle yazar; sahiplik koşulu güncellemenin içindedir (unvan için XP eşiği,
   * çerçeve için rozet). Koşul tutmazsa hiçbir alan yazılmaz ve false döner.
   */
  setAppearance(tenantId: string, playerId: string, change: AppearanceChange): Promise<boolean>;
}

export interface PlayerAppearance {
  xp: number;
  selectedTitle: string | null;
  selectedFrame: string | null;
}

/** Sıralamada gösterilecek unvan ve çerçeve için oyuncuların görünüm bilgisi. */
export interface AppearanceReader {
  find(tenantId: string, playerIds: string[]): Promise<Map<string, PlayerAppearance>>;
}

export const PROFILE_REPOSITORY = Symbol('PROFILE_REPOSITORY');
export const APPEARANCE_READER = Symbol('APPEARANCE_READER');
