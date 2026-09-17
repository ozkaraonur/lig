import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CLOCK_MS, systemClockMs } from '../common/clock';
import { LeaguesModule } from '../leagues/leagues.module';
import { PricesModule } from '../prices/prices.module';
import { DrizzleOrderUnitOfWork, DrizzlePortfolioReader } from './drizzle-orders';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PortfolioService } from './portfolio.service';
import { ORDER_UNIT_OF_WORK, PORTFOLIO_READER } from './ports';

@Module({
  imports: [AuthModule, LeaguesModule, PricesModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    PortfolioService,
    { provide: CLOCK_MS, useValue: systemClockMs },
    { provide: ORDER_UNIT_OF_WORK, useClass: DrizzleOrderUnitOfWork },
    { provide: PORTFOLIO_READER, useClass: DrizzlePortfolioReader },
  ],
})
export class OrdersModule {}
