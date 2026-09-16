import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { z } from 'zod';
import { REDIS } from '../redis/redis.module';
import { type PriceStore, type StoredPrice } from './ports';

/** Son fiyat, akış kesilse bile ekranda "bayat" olarak gösterilebilsin diye bir süre saklanır. */
export const PRICE_RETENTION_MS = 10 * 60 * 1000;

/**
 * Anahtardaki fiyattan daha yeni değilse yazmaz. Karşılaştırma ve yazma Redis içinde tek adımda
 * yapılır; iki alıcı aynı anda çalışsa bile yeni fiyat eskisiyle ezilmez.
 */
const SAVE_IF_NEWER_LUA = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and type(decoded) == 'table' and tonumber(decoded.t) and tonumber(decoded.t) >= tonumber(ARGV[2]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
return 1
`;

const storedValue = z.object({ p: z.string(), t: z.number() });

export const priceKey = (tenantId: string, symbol: string) => `price:${tenantId}:${symbol}`;

type RedisWithPriceScript = Redis & {
  savePriceIfNewer(key: string, value: string, timestamp: number, ttlMs: number): Promise<number>;
};

@Injectable()
export class RedisPriceStore implements PriceStore {
  private readonly redis: RedisWithPriceScript;

  constructor(@Inject(REDIS) redis: Redis) {
    if (!('savePriceIfNewer' in redis)) {
      redis.defineCommand('savePriceIfNewer', { numberOfKeys: 1, lua: SAVE_IF_NEWER_LUA });
    }
    this.redis = redis as RedisWithPriceScript;
  }

  async saveIfNewer(tenantId: string, prices: StoredPrice[]): Promise<number> {
    if (prices.length === 0) return 0;
    const results = await Promise.all(
      prices.map((p) =>
        this.redis.savePriceIfNewer(
          priceKey(tenantId, p.symbol),
          JSON.stringify({ p: p.price, t: p.timestamp }),
          p.timestamp,
          PRICE_RETENTION_MS,
        ),
      ),
    );
    return results.reduce((sum, r) => sum + Number(r), 0);
  }

  async getLatest(tenantId: string, symbols: string[]): Promise<Map<string, StoredPrice>> {
    const result = new Map<string, StoredPrice>();
    if (symbols.length === 0) return result;

    const values = await this.redis.mget(symbols.map((s) => priceKey(tenantId, s)));
    values.forEach((raw, i) => {
      const symbol = symbols[i];
      if (!raw || !symbol) return;
      try {
        const parsed = storedValue.safeParse(JSON.parse(raw));
        if (parsed.success) result.set(symbol, { symbol, price: parsed.data.p, timestamp: parsed.data.t });
      } catch {
        // Bozuk kayıt fiyat yokmuş gibi davranır; bir sonraki akışta üzerine yazılır.
      }
    });
    return result;
  }
}
