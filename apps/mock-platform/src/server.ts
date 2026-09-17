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
import { TRADE_PAGE_HTML, TRADE_PAGE_SCRIPT } from './trade-page.js';
import { type WebhookSender } from './webhooks.js';

export interface MockPlatformOptions {
  keys: SigningKeys;
  /** Token'lardaki `iss` değeri. Lig API'si platformu bu değerle tanır. */
  issuer: string;
  /** Giriş sonrası oyuncunun yönlendirileceği lig web uygulaması. */
  webUrl: string;
  /** Yayınlanan fiyatlar. Verilmezse varsayılan piyasalarla yeni bir simülatör kullanılır. */
  prices?: PriceSimulator;
  /** Gerçek işlem bildirimlerini lig API'sine gönderir (FR-31). Verilmezse işlem sayfası devre dışı. */
  webhooks?: WebhookSender;
  logger?: boolean;
}

const tokenRequestBody = z.object({ displayName: displayNameSchema.optional() }).strict();

/**
 * Gerçek bir kripto platformunun yerine geçen test sunucusu. Faz 1 kapsamı:
 * - GET  /                               → "oyuncu olarak gir" sayfası
 * - GET  /.well-known/lig-public-key     → açık anahtar (gerçekte platform bunu bize kurulumda verir)
 * - POST /players/:externalId/token      → imzalı, 5 dakikalık, tek kullanımlık oyuncu token'ı (FR-01)
 * - GET  /prices                         → son fiyatlar; lig API'si saniyede bir çeker (FR-30)
 * - POST /debug/prices/pause | resume     → fiyat akışını dondurur / sürdürür (bayat fiyat testi için)
 * - GET  /trade                          → "gerçek işlem" ekranı; "Gerçek hesabıma geç" buraya açılır (FR-08)
 * - POST /players/:externalId/real-trades → lig API'sine imzalı gerçek işlem bildirimi gönderir (FR-31)
 * - POST /debug/webhooks/replay-last     → son bildirimi aynı olay kimliğiyle tekrar gönderir
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

  // Yalnızca test aracı: gerçek bir platformda böyle bir uç olmaz.
  app.get('/debug/prices', async () => ({ paused: prices.paused }));
  app.post('/debug/prices/pause', async () => {
    prices.paused = true;
    return { paused: true };
  });
  app.post('/debug/prices/resume', async () => {
    prices.paused = false;
    return { paused: false };
  });

  const strictCsp =
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

  app.get('/trade', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').header('content-security-policy', strictCsp).send(TRADE_PAGE_HTML),
  );

  app.get('/trade.js', async (_request, reply) =>
    reply.type('text/javascript; charset=utf-8').send(TRADE_PAGE_SCRIPT),
  );

  app.post<{ Params: { externalId: string } }>('/players/:externalId/real-trades', async (request, reply) => {
    const id = externalPlayerId.safeParse(request.params.externalId);
    if (!id.success) {
      return reply.status(400).send({ code: 'VALIDATION_FAILED', message: 'Geçersiz oyuncu kimliği.' });
    }
    if (!options.webhooks) return reply.status(503).send({ message: 'Webhook gönderimi yapılandırılmamış.' });
    try {
      return await options.webhooks.realTrade(id.data);
    } catch {
      return reply.status(502).send({ message: "Lig API'sine ulaşılamadı. npm run dev açık mı?" });
    }
  });

  app.post('/debug/webhooks/replay-last', async (_request, reply) => {
    const pending = options.webhooks?.replayLast();
    if (!pending) return reply.status(404).send({ message: 'Henüz gönderilmiş bir bildirim yok.' });
    try {
      return await pending;
    } catch {
      return reply.status(502).send({ message: "Lig API'sine ulaşılamadı." });
    }
  });

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
