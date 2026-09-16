import Fastify, { type FastifyInstance } from 'fastify';

export interface MockPlatformOptions {
  logger?: boolean;
}

/**
 * Sahte platform. Faz 1'de şunlar eklenecek:
 * - POST /players/:externalId/token  → imzalı oyuncu JWT'si (FR-01)
 * - WS   /prices                     → fiyat akışı (FR-30)
 * - POST /simulate/real-trade        → Lig API'ye webhook (FR-31)
 */
export function buildServer(options: MockPlatformOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/health', async () => ({ status: 'up', service: 'mock-platform' }));

  return app;
}
