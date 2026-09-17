import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CLOCK_MS, systemClockMs } from '../common/clock';
import { LeaguesModule } from '../leagues/leagues.module';
import { PricesModule } from '../prices/prices.module';
import {
  DrizzleFinalStandingsReader,
  DrizzleLeagueCloseUnitOfWork,
  DrizzleRankingSource,
} from './drizzle-ranking';
import { LeagueCloseService } from './league-close.service';
import { LeagueSchedulerWorker } from './league-scheduler.worker';
import { FINAL_STANDINGS_READER, LEAGUE_CLOSE_UOW, RANKING_SOURCE, RANKING_STORE } from './ports';
import { RankingController } from './ranking.controller';
import { RankingService } from './ranking.service';
import { RedisRankingStore } from './redis-ranking.store';

@Module({
  imports: [AuthModule, LeaguesModule, PricesModule],
  controllers: [RankingController],
  providers: [
    RankingService,
    LeagueCloseService,
    LeagueSchedulerWorker,
    { provide: CLOCK_MS, useValue: systemClockMs },
    { provide: RANKING_SOURCE, useClass: DrizzleRankingSource },
    { provide: RANKING_STORE, useClass: RedisRankingStore },
    { provide: FINAL_STANDINGS_READER, useClass: DrizzleFinalStandingsReader },
    { provide: LEAGUE_CLOSE_UOW, useClass: DrizzleLeagueCloseUnitOfWork },
  ],
})
export class RankingModule {}
