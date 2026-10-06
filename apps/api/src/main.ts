import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { configureApp, trustProxyOption } from './app.setup';
import { ENV, type Env, loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  // Güvenilir vekil listesi adaptör kurulurken gerekir; ortam ayarı Nest modülünden önce okunur.
  const trustProxy = trustProxyOption(loadEnv().TRUST_PROXY);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy, bodyLimit: 64 * 1024 }),
    // Webhook imzası ham gövde üzerinden doğrulanır (FR-31).
    { rawBody: true },
  );
  const env = app.get<Env>(ENV);

  await configureApp(app, { webOrigin: env.WEB_ORIGIN });
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, env.API_HOST);
  Logger.log(`API listening on http://${env.API_HOST}:${env.API_PORT}`, 'Bootstrap');
}

void bootstrap();
