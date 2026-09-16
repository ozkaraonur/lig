import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

/** Uygulamanın ve testlerin aynı güvenlik ayarlarıyla çalışması için tek yer. */
export async function configureApp(
  app: NestFastifyApplication,
  options: { webOrigin: string },
): Promise<void> {
  await app.register(cookie);
  await app.register(helmet);
  app.enableCors({ origin: options.webOrigin, credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter());
}
