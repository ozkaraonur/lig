import { z } from 'zod';
import { leagueName } from './admin-leagues';

/**
 * Arkadaş ligi (FR-09, K-033). Oyuncu kurar, davet koduyla girilir. Küçük ve kapalı bir ligdir: yalnızca
 * üyeleri görür, XP ve rozet vermez (iki hesapla XP taşınmasın, K-017). Kurallar kodda sabit, oyuncu ya da
 * yönetici değiştiremez.
 */
export const FRIENDS_LEAGUE = {
  maxMembers: 10,
  startingCash: '100000.00',
  durationDays: [7, 14, 30] as const,
  /** Bir oyuncunun aynı anda sürdürebildiği, kendi kurduğu arkadaş ligi sayısı. */
  maxOwnedActive: 3,
  codeLength: 10,
};

/** Karışan karakterler (0, O, 1, I) yok: kod elle yazılır. 32 harf, 10 karakter ≈ 50 bit. */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Kodu büyük harfe çevirir, boşluk ve tire atar: "abcde-fghjk" ile "ABCDEFGHJK" aynı koddur. */
export function normalizeInviteCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** Ekranda okunaklı gösterim: "ABCDE-FGHJK". */
export function formatInviteCode(code: string): string {
  const half = Math.floor(code.length / 2);
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

const DURATION_DAYS = FRIENDS_LEAGUE.durationDays;

export const createFriendsLeagueRequest = z.strictObject({
  name: leagueName,
  durationDays: z.union([
    z.literal(DURATION_DAYS[0]),
    z.literal(DURATION_DAYS[1]),
    z.literal(DURATION_DAYS[2]),
  ]),
});
export type CreateFriendsLeagueRequest = z.infer<typeof createFriendsLeagueRequest>;

export const joinByCodeRequest = z.strictObject({
  code: z
    .string()
    .max(40)
    .transform(normalizeInviteCode)
    .pipe(z.string().regex(new RegExp(`^[${INVITE_CODE_ALPHABET}]{${FRIENDS_LEAGUE.codeLength}}$`))),
});
export type JoinByCodeRequest = z.infer<typeof joinByCodeRequest>;

export interface FriendsLeagueResponse {
  leagueId: string;
  /** false: oyuncu zaten üyeydi. */
  created: boolean;
}
