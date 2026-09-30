import { randomInt } from 'node:crypto';
import {
  type CreateFriendsLeagueRequest,
  FRIENDS_LEAGUE,
  type FriendsLeagueResponse,
  INVITE_CODE_ALPHABET,
  LEAGUE_LIMITS,
} from '@lig/shared';
import { and, count, eq, gt, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { type Database } from '../db/db.module';
import { assets, leagues, memberships, players } from '../db/schema';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Kod çakışması pratikte yok (50 bit); yine de birkaç kez denenir. */
const CODE_ATTEMPTS = 5;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const invalidInviteCode = () => new AppError('NOT_FOUND', 404, 'Davet kodu geçersiz.');

export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < FRIENDS_LEAGUE.codeLength; i += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Arkadaş ligi kurar ve kurucuyu üye yapar (FR-09, K-033). Oyuncu başına danışma kilidi: aynı oyuncunun
 * eşzamanlı iki kurma isteği "en fazla 3 lig" sayımını birlikte aşamaz. Varlıklar oyuncunun platformunun
 * varlıklarıdır; lig kuralları (bakiye, kontenjan, süre seçenekleri) kodda sabit.
 */
export async function createFriendsLeague(
  db: Database,
  tenantId: string,
  playerId: string,
  request: CreateFriendsLeagueRequest,
  now: Date,
  newCode: () => string = generateInviteCode,
): Promise<FriendsLeagueResponse> {
  return db.transaction(async (tx: Tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`friends-create:${playerId}`}, 0))`);

    const [player] = await tx
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.id, playerId), eq(players.tenantId, tenantId)));
    if (!player) throw new AppError('NOT_FOUND', 404, 'Oyuncu bulunamadı.');

    const [owned] = await tx
      .select({ n: count() })
      .from(leagues)
      .where(
        and(
          eq(leagues.ownerPlayerId, playerId),
          eq(leagues.type, 'friends'),
          eq(leagues.status, 'active'),
          gt(leagues.endsAt, now),
        ),
      );
    if ((owned?.n ?? 0) >= FRIENDS_LEAGUE.maxOwnedActive) {
      throw new AppError(
        'CONFLICT',
        409,
        `Aynı anda en fazla ${FRIENDS_LEAGUE.maxOwnedActive} arkadaş ligin olabilir.`,
      );
    }

    const tenantAssets = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.tenantId, tenantId))
      .orderBy(assets.symbol)
      .limit(LEAGUE_LIMITS.assetsMax);
    if (tenantAssets.length === 0) throw new AppError('CONFLICT', 409, 'Bu platformda henüz varlık yok.');

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const [league] = await tx
        .insert(leagues)
        .values({
          tenantId,
          name: request.name,
          type: 'friends',
          status: 'active',
          startsAt: now,
          endsAt: new Date(now.getTime() + request.durationDays * DAY_MS),
          startingCash: FRIENDS_LEAGUE.startingCash,
          assetIds: tenantAssets.map((a) => a.id),
          maxMembers: FRIENDS_LEAGUE.maxMembers,
          lateJoinAllowed: true,
          inviteCode: newCode(),
          ownerPlayerId: playerId,
        })
        .onConflictDoNothing({ target: leagues.inviteCode })
        .returning({ id: leagues.id });
      if (!league) continue;
      await tx
        .insert(memberships)
        .values({ leagueId: league.id, playerId, cash: FRIENDS_LEAGUE.startingCash });
      return { leagueId: league.id, created: true };
    }
    throw new AppError('INTERNAL', 500, 'Davet kodu üretilemedi, tekrar dene.');
  });
}

/**
 * Davet koduyla arkadaş ligine katılır. Kod yalnızca oyuncunun kendi platformundaki arkadaş liglerinde aranır:
 * başka platformun kodu, var olmayan kod ve arkadaş ligi olmayan lig aynı 404'ü alır (T4). Katılım, normal
 * lig katılımıyla aynı danışma kilidini kullanır; 10 kişilik kontenjan eşzamanlı katılımla aşılamaz.
 */
export async function joinByCode(
  db: Database,
  tenantId: string,
  playerId: string,
  code: string,
  now: Date,
): Promise<FriendsLeagueResponse> {
  return db.transaction(async (tx: Tx) => {
    const [found] = await tx
      .select({ id: leagues.id })
      .from(leagues)
      .where(and(eq(leagues.inviteCode, code), eq(leagues.tenantId, tenantId), eq(leagues.type, 'friends')));
    if (!found) throw invalidInviteCode();
    const leagueId = found.id;

    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`league-join:${leagueId}`}, 0))`);

    const [player] = await tx
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.id, playerId), eq(players.tenantId, tenantId)));
    if (!player) throw new AppError('NOT_FOUND', 404, 'Oyuncu bulunamadı.');

    const [existing] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.leagueId, leagueId), eq(memberships.playerId, playerId)));
    if (existing) return { leagueId, created: false };

    // Kapanışla yarışmamak için lig satırı paylaşımlı kilitle okunur (kapanış FOR UPDATE alır).
    const [league] = await tx
      .select({ status: leagues.status, endsAt: leagues.endsAt, maxMembers: leagues.maxMembers })
      .from(leagues)
      .where(eq(leagues.id, leagueId))
      .for('share');
    if (!league || league.status !== 'active' || league.endsAt <= now) {
      throw new AppError('LEAGUE_NOT_ACTIVE', 409, 'Bu arkadaş ligi sona erdi.');
    }

    const [members] = await tx
      .select({ n: count() })
      .from(memberships)
      .where(eq(memberships.leagueId, leagueId));
    if (league.maxMembers !== null && (members?.n ?? 0) >= league.maxMembers) {
      throw new AppError('LEAGUE_FULL', 409, 'Bu ligin kontenjanı doldu.');
    }

    await tx
      .insert(memberships)
      .values({ leagueId, playerId, cash: FRIENDS_LEAGUE.startingCash })
      .onConflictDoNothing();
    return { leagueId, created: true };
  });
}
