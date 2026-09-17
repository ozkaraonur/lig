import { type XpReason } from '@lig/shared';
import { sql } from 'drizzle-orm';
import { type Database } from '../db/db.module';

export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export interface XpGrant {
  playerId: string;
  reason: XpReason;
  /** Ödülün kaynağı: lig kimliği, "görevKimliği:dönem" gibi. */
  sourceId: string;
  amount: number;
}

/** PostgreSQL tek sorguda en fazla 65.535 parametre kabul eder; satır başına 4 parametreyle güvenli pay. */
const CHUNK_SIZE = 5_000;

/**
 * XP'yi deftere (xp_ledger) yazar ve yalnızca gerçekten yeni eklenen satırların XP'sini oyuncuya ekler.
 * (oyuncu, sebep, kaynak) tekil olduğu için aynı ödül iki kez verilemez. Gerçekten verilen toplamı döner.
 * Çağıranın transaction'ı içinde çalışır.
 */
export async function grantXp(db: DbExecutor, all: XpGrant[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < all.length; i += CHUNK_SIZE) {
    total += await grantChunk(db, all.slice(i, i + CHUNK_SIZE));
  }
  return total;
}

async function grantChunk(db: DbExecutor, grants: XpGrant[]): Promise<number> {
  if (grants.length === 0) return 0;
  const values = sql.join(
    grants.map((g) => sql`(${g.playerId}::uuid, ${g.reason}::xp_reason, ${g.sourceId}, ${g.amount}::int)`),
    sql`, `,
  );
  // Aynı oyuncunun birden fazla satırı olabilir: UPDATE ... FROM eşleşen satırlardan yalnızca birini
  // uygular, bu yüzden önce oyuncu başına toplanır.
  const result = await db.execute<{ total: number | null }>(sql`
    with inserted as (
      insert into xp_ledger (player_id, reason, source_id, amount)
      values ${values}
      on conflict (player_id, reason, source_id) do nothing
      returning player_id, amount
    ),
    per_player as (
      select player_id, sum(amount)::int as amount from inserted group by player_id
    ),
    updated as (
      update players p set xp = p.xp + pp.amount
      from per_player pp where p.id = pp.player_id
      returning pp.amount
    )
    select coalesce(sum(amount), 0)::int as total from updated
  `);
  return Number(result.rows[0]?.total ?? 0);
}
