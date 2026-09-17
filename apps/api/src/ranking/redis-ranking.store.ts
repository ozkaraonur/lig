import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { type RankingStore, type StoredRankEntry } from './ports';
import { type Standing } from './standings';

export const rankingKey = (leagueId: string) => `league:${leagueId}:ranking`;
const updatedKey = (leagueId: string) => `league:${leagueId}:ranking:updated`;

/** Süren lig bittikten sonra en fazla bu kadar Redis'te kalır; kapanışta zaten silinir. */
const RANKING_TTL_SECONDS = 7 * 24 * 60 * 60;
const ZADD_CHUNK = 1_000;

/**
 * Skor, toplam değerin kuruş cinsinden tam sayısıdır. Redis skorları double'dır; 2^53 kuruşa (90 trilyon TL)
 * kadar tam sayılar kayıpsız tutulur, sanal bir ligde bunun aşılması mümkün değil.
 */
function toScore(valueUnits: bigint): number {
  if (valueUnits > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('portfolio value exceeds score precision');
  return Number(valueUnits);
}

@Injectable()
export class RedisRankingStore implements RankingStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Sıralama geçici anahtara yazılıp tek adımda yerine konur: okuyan hiçbir zaman yarım liste görmez. */
  async replace(leagueId: string, standings: Standing[], updatedAtMs: number): Promise<void> {
    const key = rankingKey(leagueId);
    const tmp = `${key}:tmp:${process.pid}:${updatedAtMs}`;
    const multi = this.redis.multi().del(tmp);
    for (let i = 0; i < standings.length; i += ZADD_CHUNK) {
      const args = standings.slice(i, i + ZADD_CHUNK).flatMap((s) => [toScore(s.valueUnits), s.playerId]);
      multi.zadd(tmp, ...args);
    }
    if (standings.length > 0) {
      multi.rename(tmp, key).expire(key, RANKING_TTL_SECONDS);
    } else {
      multi.del(key);
    }
    multi.set(updatedKey(leagueId), String(updatedAtMs), 'EX', RANKING_TTL_SECONDS);
    const results = await multi.exec();
    const failed = results?.find(([err]) => err);
    if (failed) throw failed[0];
  }

  async top(leagueId: string, limit: number): Promise<StoredRankEntry[]> {
    const raw = await this.redis.zrevrange(rankingKey(leagueId), 0, limit - 1, 'WITHSCORES');
    const entries: StoredRankEntry[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      const playerId = raw[i]!;
      const score = Number(raw[i + 1]);
      // Liste en baştan başladığı için sıra = konum + 1; eşit skor önceki sırayı paylaşır.
      const previous = entries.at(-1);
      const rank = previous && Number(previous.valueUnits) === score ? previous.rank : entries.length + 1;
      entries.push({ playerId, valueUnits: BigInt(score), rank });
    }
    return entries;
  }

  async entryFor(leagueId: string, playerId: string): Promise<StoredRankEntry | null> {
    const score = await this.redis.zscore(rankingKey(leagueId), playerId);
    if (score === null) return null;
    const value = Number(score);
    return { playerId, valueUnits: BigInt(value), rank: await this.rankOfScore(leagueId, value) };
  }

  count(leagueId: string): Promise<number> {
    return this.redis.zcard(rankingKey(leagueId));
  }

  async updatedAt(leagueId: string): Promise<number | null> {
    const value = await this.redis.get(updatedKey(leagueId));
    return value ? Number(value) : null;
  }

  async remove(leagueId: string): Promise<void> {
    await this.redis.del(rankingKey(leagueId), updatedKey(leagueId));
  }

  /** Sıra = kendisinden kesin büyük skor sayısı + 1. Eşit skorlar aynı sırayı alır. */
  private async rankOfScore(leagueId: string, score: number): Promise<number> {
    return (await this.redis.zcount(rankingKey(leagueId), `(${score}`, '+inf')) + 1;
  }
}
