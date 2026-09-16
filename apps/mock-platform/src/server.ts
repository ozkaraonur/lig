import { randomUUID } from 'node:crypto';
import {
  displayName as displayNameSchema,
  externalPlayerId,
  MAX_PLAYER_TOKEN_TTL_SECONDS,
  PLAYER_TOKEN_ALGORITHM,
  PLAYER_TOKEN_AUDIENCE,
} from '@lig/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';
import { type SigningKeys } from './keys.js';
import { LOGIN_PAGE_HTML, LOGIN_PAGE_SCRIPT } from './login-page.js';
import { PriceSimulator } from './prices.js';

export interface MockPlatformOptions {
  keys: SigningKeys;
  /** Token'lardaki `iss` değeri. Lig API'si platformu bu değerle tanır. */
  issuer: string;
  /** Giriş sonrası oyuncunun yönlendirileceği lig web uygulaması. */
  webUrl: string;
  /** Yayınlanan fiyatlar. Verilmezse varsayılan piyasalarla yeni bir simülatör kullanılır. */
  prices?: PriceSimulator;
  logger?: boolean;
}

const tokenRequestBody = z.object({ displayName: displayNameSchema.optional() }).strict();

/**
 * Gerçek bir kripto platformunun yerine geçen test sunucusu. Faz 1 kapsamı:
 * - GET  /                               → "oyuncu olarak gir" sayfası
 * - GET  /.well-known/lig-public-key     → açık anahtar (gerçekte platform bunu bize kurulumda verir)
 * - POST /players/:externalId/token      → imzalı, 5 dakikalık, tek kullanımlık oyuncu token'ı (FR-01)
 * - GET  /prices                         → son fiyatlar; lig API'si saniyede bir çeker (FR-30)
 */
export async function buildServer(options: MockPlatformOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 16 * 1024 });
  const prices = options.prices ?? new PriceSimulator();
  const privateKey = await importPKCS8(options.keys.privateKeyPem, PLAYER_TOKEN_ALGORITHM);

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });

  app.get('/health', async () => ({ status: 'up', service: 'mock-platform' }));

  app.get('/.well-known/lig-public-key', async () => ({
    issuer: options.issuer,
    algorithm: PLAYER_TOKEN_ALGORITHM,
    publicKeyPem: options.keys.publicKeyPem,
  }));

  app.post<{ Params: { externalId: string } }>('/players/:externalId/token', async (request, reply) => {
    const id = externalPlayerId.safeParse(request.params.externalId);
    const body = tokenRequestBody.safeParse(request.body ?? {});
    if (!id.success || !body.success) {
      return reply
        .status(400)
        .send({ code: 'VALIDATION_FAILED', message: 'Geçersiz oyuncu kimliği ya da ad.' });
    }

    const claims = body.data.displayName ? { name: body.data.displayName } : {};
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: PLAYER_TOKEN_ALGORITHM, typ: 'JWT' })
      .setIssuer(options.issuer)
      .setAudience(PLAYER_TOKEN_AUDIENCE)
      .setSubject(id.data)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${MAX_PLAYER_TOKEN_TTL_SECONDS}s`)
      .sign(privateKey);

    return reply.header('cache-control', 'no-store').send({ token, expiresIn: MAX_PLAYER_TOKEN_TTL_SECONDS });
  });

  // Saniyede bir çağrılır; her isteği loglamak terminali doldurur.
  app.get('/prices', { logLevel: 'warn' }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send({ ticks: prices.snapshot() }),
  );

  app.get('/', async (_request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .header(
        'content-security-policy',
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
      )
      .send(LOGIN_PAGE_HTML.replace('__WEB_URL__', encodeURIComponent(options.webUrl))),
  );

  app.get('/login.js', async (_request, reply) =>
    reply.type('text/javascript; charset=utf-8').send(LOGIN_PAGE_SCRIPT),
  );

  return app;
}
