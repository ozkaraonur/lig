import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { LeaguesModule } from './leagues/leagues.module';
import { OrdersModule } from './orders/orders.module';
import { PricesModule } from './prices/prices.module';
import { QuestsModule } from './quests/quests.module';
import { RankingModule } from './ranking/ranking.module';
import { RedisModule } from './redis/redis.module';
import { SecretsModule } from './secrets/secrets.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    RedisModule,
    SecretsModule,
    HealthModule,
    AuthModule,
    PricesModule,
    LeaguesModule,
    OrdersModule,
    RankingModule,
    QuestsModule,
    WebhooksModule,
    AdminAuthModule,
  ],
})
export class AppModule {}
