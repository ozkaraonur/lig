import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { LeaguesModule } from './leagues/leagues.module';
import { OrdersModule } from './orders/orders.module';
import { PricesModule } from './prices/prices.module';
import { RankingModule } from './ranking/ranking.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    RedisModule,
    HealthModule,
    AuthModule,
    PricesModule,
    LeaguesModule,
    OrdersModule,
    RankingModule,
  ],
})
export class AppModule {}
