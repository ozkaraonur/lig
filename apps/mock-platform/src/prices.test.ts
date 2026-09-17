import { priceTick } from '@lig/shared';
import { describe, expect, it } from 'vitest';
import { PriceSimulator } from './prices.js';

/** Tekrarlanabilir sözde rastgele sayı üreteci (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('PriceSimulator', () => {
  const markets = [{ symbol: 'BTC', start: 100, decimals: 2, volatility: 0.5 }];

  it('starts at the configured price with the current timestamp', () => {
    const sim = new PriceSimulator(markets, seeded(1), () => 1_000);
    expect(sim.snapshot()).toEqual([{ symbol: 'BTC', price: '100.00', timestamp: 1_000 }]);
  });

  it('moves prices and updates timestamps on each tick', () => {
    let now = 1_000;
    const sim = new PriceSimulator(markets, seeded(2), () => now);
    now = 2_000;
    sim.tick();
    const [tick] = sim.snapshot();
    expect(tick?.price).not.toBe('100.00');
    expect(tick?.timestamp).toBe(2_000);
  });

  it('is deterministic for the same seed', () => {
    const run = () => {
      const sim = new PriceSimulator(markets, seeded(42), () => 1);
      for (let i = 0; i < 10; i++) sim.tick();
      return sim.snapshot();
    };
    expect(run()).toEqual(run());
  });

  it('never produces a price the API would reject, even with extreme volatility', () => {
    const sim = new PriceSimulator(
      [{ symbol: 'DOGE', start: 0.5, decimals: 5, volatility: 3 }],
      seeded(7),
      () => 1,
    );
    for (let i = 0; i < 2_000; i++) {
      sim.tick();
      for (const tick of sim.snapshot()) expect(priceTick.safeParse(tick).success).toBe(true);
    }
  });

  it('does not move prices or timestamps while paused', () => {
    let now = 1_000;
    const sim = new PriceSimulator(markets, seeded(3), () => now);
    sim.paused = true;
    now = 9_000;
    sim.tick();
    expect(sim.snapshot()).toEqual([{ symbol: 'BTC', price: '100.00', timestamp: 1_000 }]);
  });
});
