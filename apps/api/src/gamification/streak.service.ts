import { Inject, Injectable } from '@nestjs/common';
import { type StreakView } from '@lig/shared';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { DB, type Database } from '../db/db.module';
import { activateJoker, awardStreak, recordVisit, streakView } from './streak-store';

@Injectable()
export class StreakService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  get(tenantId: string, playerId: string): Promise<StreakView> {
    return streakView(this.db, tenantId, playerId, new Date(this.clock()));
  }

  /** Oyuncu ekranı açılınca çağrılır: bugünü etkin gün yazar ve eşik ödüllerini verir. */
  async visit(tenantId: string, playerId: string): Promise<StreakView> {
    const now = new Date(this.clock());
    await this.db.transaction(async (tx) => {
      await recordVisit(tx, tenantId, playerId, now);
      await awardStreak(tx, tenantId, playerId, now);
    });
    return streakView(this.db, tenantId, playerId, now);
  }

  async activateJoker(tenantId: string, playerId: string): Promise<StreakView> {
    const now = new Date(this.clock());
    await this.db.transaction((tx) => activateJoker(tx, tenantId, playerId, now));
    return streakView(this.db, tenantId, playerId, now);
  }
}
