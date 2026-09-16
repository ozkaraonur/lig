import 'reflect-metadata';
import helmet from '@fastify/helmet';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: false, bodyLimit: 64 * 1024 }),
  );
  const env = app.get<Env>(ENV);

  await app.register(helmet);
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, '0.0.0.0');
  Logger.log(`API listening on port ${env.API_PORT}`, 'Bootstrap');
}

void bootstrap();
