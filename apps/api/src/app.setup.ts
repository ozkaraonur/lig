import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { type ApiError } from '@lig/shared';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

/** Uygulamanın ve testlerin aynı güvenlik ayarlarıyla çalışması için tek yer. */
export async function configureApp(
  app: NestFastifyApplication,
  options: { webOrigin: string },
): Promise<void> {
  await app.register(cookie);
  await app.register(helmet);
  // Varsayılan CORS yöntemleri yalnızca GET, HEAD, POST; yönetim paneli PATCH ve DELETE de kullanıyor.
  app.enableCors({
    origin: options.webOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
  });
  rejectNonJsonBodies(app);
  app.useGlobalFilters(new AllExceptionsFilter());
}

/**
 * Fastify'ın `trustProxy` ayarı. Liste boşsa X-Forwarded-For hiç okunmaz (istemci kendi IP'sini yazamaz).
 * Doluysa yalnızca bu adreslerden gelen bağlantıdaki başlığa güvenilir ve istemci IP'si olarak güvenilmeyen
 * ilk adres (sağdan) alınır. Fastify'ın sayı biçimi (kaç sıçrama) bu davranışı vermediği için liste kullanılır.
 */
export function trustProxyOption(trusted: readonly string[]): string[] | false {
  return trusted.length > 0 ? [...trusted] : false;
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Gövdeli her istek JSON olmak zorunda (T1, T6). NestJS'in Fastify adaptörü form gövdesini
 * (application/x-www-form-urlencoded) varsayılan olarak ayrıştırır. Başka bir sitedeki düz bir HTML formu
 * CORS ön kontrolüne takılmadan böyle istek gönderebilir: çerez gerektirmeyen giriş uçlarında bu,
 * kurbanın saldırganın hesabıyla oturum açtırılması (login CSRF) demektir. JSON gövde ise tarayıcıda
 * yalnızca CORS izniyle gönderilebilir.
 */
function rejectNonJsonBodies(app: NestFastifyApplication): void {
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (request, reply) => {
      if (!BODY_METHODS.has(request.method)) return;
      const length = Number(request.headers['content-length'] ?? 0);
      const hasBody = length > 0 || request.headers['transfer-encoding'] !== undefined;
      if (!hasBody) return;
      const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
      if (type === 'application/json') return;
      await reply
        .status(415)
        .send({ code: 'VALIDATION_FAILED', message: 'İstek gövdesi JSON olmalı.' } satisfies ApiError);
    });
}
