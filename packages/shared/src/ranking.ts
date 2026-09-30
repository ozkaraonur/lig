import { z } from 'zod';
import { type FrameId } from './gamification';

/** Kullanıcı hikâyesi (FR-06): ilk 5 oyuncu ve oyuncunun kendi satırı her zaman görünür. */
export const LEADERBOARD_DEFAULT_LIMIT = 5;
export const LEADERBOARD_MAX_LIMIT = 50;

export const leaderboardQuery = z.object({
  limit: z.coerce.number().int().min(1).max(LEADERBOARD_MAX_LIMIT).default(LEADERBOARD_DEFAULT_LIMIT),
});

export interface LeaderboardEntry {
  /** Eşit değerli oyuncular aynı sırayı paylaşır (1, 2, 2, 4). */
  rank: number;
  displayName: string;
  /** Oyuncunun görünen unvanı (XP eşiğinden türetilir ya da seçtiği unvan, FR-10). */
  title: string;
  /** Seçtiği profil çerçevesi; yoksa null. */
  frame: FrameId | null;
  totalValue: string;
  /** Başlangıç bakiyesine göre getiri, işaretli, 2 ondalık. */
  returnPercent: string;
  isMe: boolean;
}

export interface LeaderboardView {
  /** true: lig kapandı, sıralama dondu ve değişmeyecek (FR-32). */
  final: boolean;
  /** Sıralamanın en son hesaplandığı an. Henüz hesaplanmadıysa null. */
  updatedAt: string | null;
  playerCount: number;
  top: LeaderboardEntry[];
  /** Oyuncu bu ligin üyesi değilse null. */
  me: (LeaderboardEntry & { xpAwarded: number | null }) | null;
}
