/**
 * Kademe ligleri (Faz 3, K-034). Oyuncular haftalık, yaklaşık 50 kişilik gruplarda yarışır; hafta sonunda
 * grubun üst %20'si bir üst kademeye çıkar, alt %20'si bir alt kademeye iner. Kademe yalnızca görünümdür:
 * XP, bakiye ya da sıralama vermez (NFR-06, K-017).
 */
export const TIERS = [
  { id: 'bronze', name: 'Bronz' },
  { id: 'silver', name: 'Gümüş' },
  { id: 'gold', name: 'Altın' },
  { id: 'platinum', name: 'Platin' },
  { id: 'legend', name: 'Efsane' },
] as const;

export type TierId = (typeof TIERS)[number]['id'];
export const TIER_IDS = TIERS.map((t) => t.id) as [TierId, ...TierId[]];

export const TIER_LEAGUE = {
  /** Bir gruptaki en fazla oyuncu. Dolunca aynı kademede yeni grup açılır. */
  groupSize: 50,
  startingCash: '100000.00',
  /** Yükselme ve düşme oranı (grubun yüzde kaçı). */
  moveRatio: 0.2,
  /** Hareketin uygulanması için gruptaki en az emir vermiş oyuncu sayısı. Küçük grupta hareket yok. */
  minParticipants: 5,
};

export function tierName(id: TierId): string {
  return TIERS.find((t) => t.id === id)!.name;
}

export function tierIndex(id: TierId): number {
  return TIER_IDS.indexOf(id);
}

export function higherTier(id: TierId): TierId {
  return TIER_IDS[Math.min(tierIndex(id) + 1, TIER_IDS.length - 1)]!;
}

export function lowerTier(id: TierId): TierId {
  return TIER_IDS[Math.max(tierIndex(id) - 1, 0)]!;
}

export interface TierParticipant {
  playerId: string;
  /** Kapanıştaki nihai sıra; eşit değerler aynı sırayı paylaşır (1, 2, 2, 4). */
  rank: number;
}

export interface TierMovement {
  playerId: string;
  from: TierId;
  to: TierId;
  rank: number;
}

/**
 * Grubun kademe hareketlerini hesaplar. Yalnızca emir vermiş oyuncular (`participants`) sayılır: hiç
 * oynamayan ne yükselir ne düşer. Grupta `minParticipants` kişiden az varsa kimse hareket etmez.
 * Hareket sayısı `floor(n * oran)`; eşit sıradaki oyuncular sınırı aşacaksa o eşitlik grubu tümüyle dışarıda
 * kalır, böylece hiçbir zaman hak edilenden fazla kişi yükselmez ya da düşmez. En üst kademede yükselme,
 * en alt kademede düşme yoktur.
 */
export function computeTierMovements(tier: TierId, participants: readonly TierParticipant[]): TierMovement[] {
  const n = participants.length;
  if (n < TIER_LEAGUE.minParticipants) return [];
  const quota = Math.floor(n * TIER_LEAGUE.moveRatio);
  if (quota < 1) return [];

  const sorted = [...participants].sort((a, b) => a.rank - b.rank || a.playerId.localeCompare(b.playerId));
  const movements: TierMovement[] = [];

  const take = (ordered: TierParticipant[], to: TierId) => {
    let taken = 0;
    let i = 0;
    while (i < ordered.length) {
      const group = ordered.filter((p) => p.rank === ordered[i]!.rank);
      if (taken + group.length > quota) break;
      for (const p of group) movements.push({ playerId: p.playerId, from: tier, to, rank: p.rank });
      taken += group.length;
      i += group.length;
    }
  };

  if (tier !== 'legend') take(sorted, higherTier(tier));
  if (tier !== 'bronze') take([...sorted].reverse(), lowerTier(tier));
  return movements;
}

export interface TierView {
  tier: TierId;
  tierName: string;
  /** Bu haftanın bitişi (Türkiye takvimiyle pazartesi 00:00). */
  weekEndsAt: string;
  /** Oyuncunun bu haftaki grubu; katılmadıysa null. */
  league: { id: string; name: string; group: number } | null;
  /** Son kapanan haftanın hareketi; yoksa null. */
  lastMovement: { from: TierId; to: TierId; rank: number } | null;
}
