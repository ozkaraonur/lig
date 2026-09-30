import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AdminLeaguesModule } from './admin-leagues/admin-leagues.module';
import { AdminSettingsModule } from './admin-settings/admin-settings.module';
import { AdminTeamModule } from './admin-team/admin-team.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { FriendsModule } from './friends/friends.module';
import { GamificationModule } from './gamification/gamification.module';
import { HealthModule } from './health/health.module';
import { LeaguesModule } from './leagues/leagues.module';
import { MetricsModule } from './metrics/metrics.module';
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
    AuditModule,
    HealthModule,
    AuthModule,
    PricesModule,
    LeaguesModule,
    OrdersModule,
    RankingModule,
    QuestsModule,
    GamificationModule,
    FriendsModule,
    WebhooksModule,
    AdminAuthModule,
    AdminTeamModule,
    AdminLeaguesModule,
    AdminSettingsModule,
    MetricsModule,
  ],
})
export class AppModule {}
