import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';
import { HealthService, type HealthReport } from './health.service';

async function createApp(report: HealthReport): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: HealthService, useValue: { check: async () => report } }],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('GET /health', () => {
  let app: NestFastifyApplication | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it('returns 200 when healthy', async () => {
    app = await createApp({ status: 'up', checks: { database: 'up', redis: 'up' } });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'up' });
  });

  it('returns 503 when a dependency is down', async () => {
    app = await createApp({ status: 'down', checks: { database: 'down', redis: 'up' } });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
  });
});
