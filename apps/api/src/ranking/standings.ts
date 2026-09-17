import { type PositionToValue, totalValueUnits } from '../orders/valuation';
import { type XpGrant } from '../xp/xp-ledger';

export type { XpGrant };

export interface MemberHolding {
  membershipId: string;
  playerId: string;
  cash: string;
  joinedAt: Date;
  positions: Array<Omit<PositionToValue, 'price'> & { assetId: string; symbol: string }>;
}

export interface Standing {
  membershipId: string;
  playerId: string;
  valueUnits: bigint;
  /** Eşit değerde aynı sıra (standart yarışma sıralaması: 1, 2, 2, 4). */
  rank: number;
}

/**
 * Üyeleri toplam değere göre büyükten küçüğe sıralar (FR-06). Eşit değerde sıra paylaşılır; listedeki
 * yerleri önce katılan önde olacak şekilde sabittir, böylece aynı veri her zaman aynı sonucu verir.
 */
export function computeStandings(
  holdings: MemberHolding[],
  priceByAssetId: ReadonlyMap<string, string | null>,
): Standing[] {
  const valued = holdings.map((h) => ({
    membershipId: h.membershipId,
    playerId: h.playerId,
    joinedAt: h.joinedAt.getTime(),
    valueUnits: totalValueUnits(
      h.cash,
      h.positions.map((p) => ({ ...p, price: priceByAssetId.get(p.assetId) ?? null })),
    ),
  }));

  valued.sort((a, b) =>
    a.valueUnits === b.valueUnits
      ? a.joinedAt - b.joinedAt || a.membershipId.localeCompare(b.membershipId)
      : a.valueUnits > b.valueUnits
        ? -1
        : 1,
  );

  let previous: { valueUnits: bigint; rank: number } | null = null;
  return valued.map((v, index) => {
    const rank = previous && previous.valueUnits === v.valueUnits ? previous.rank : index + 1;
    previous = { valueUnits: v.valueUnits, rank };
    return { membershipId: v.membershipId, playerId: v.playerId, valueUnits: v.valueUnits, rank };
  });
}

/**
 * Lig sonu XP ödülleri (FR-32, K-011). Nakit ödül yoktur (NFR-06).
 * Ödül için ligde en az bir emir vermiş olmak gerekir: hiç işlem yapmadan, düşen piyasada
 * başlangıç bakiyesiyle birinci olunamaz.
 */
export const LEAGUE_REWARDS = {
  byRank: { 1: 1000, 2: 600, 3: 400 } as Record<number, number>,
  topTenPercent: 150,
  participation: 50,
};

export function computeRewards(
  leagueId: string,
  standings: Standing[],
  tradedMembershipIds: ReadonlySet<string>,
): XpGrant[] {
  const topTenPercentRank = Math.ceil(standings.length * 0.1);
  return standings.flatMap((s): XpGrant[] => {
    if (!tradedMembershipIds.has(s.membershipId)) return [];
    const podium = LEAGUE_REWARDS.byRank[s.rank];
    if (podium) return [{ playerId: s.playerId, reason: 'league_rank', sourceId: leagueId, amount: podium }];
    if (s.rank <= topTenPercentRank) {
      return [
        {
          playerId: s.playerId,
          reason: 'league_rank',
          sourceId: leagueId,
          amount: LEAGUE_REWARDS.topTenPercent,
        },
      ];
    }
    return [
      {
        playerId: s.playerId,
        reason: 'league_participation',
        sourceId: leagueId,
        amount: LEAGUE_REWARDS.participation,
      },
    ];
  });
}
