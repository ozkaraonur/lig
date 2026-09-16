import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CLOCK_MS, systemClockMs } from '../common/clock';
import { PricesModule } from '../prices/prices.module';
import { DrizzleLeagueRepository } from './drizzle-league.repository';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';
import { LEAGUE_REPOSITORY } from './ports';

@Module({
  imports: [AuthModule, PricesModule],
  controllers: [LeaguesController],
  providers: [
    LeaguesService,
    { provide: CLOCK_MS, useValue: systemClockMs },
    { provide: LEAGUE_REPOSITORY, useClass: DrizzleLeagueRepository },
  ],
})
export class LeaguesModule {}
