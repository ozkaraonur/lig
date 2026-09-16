import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildServer } from './server.js';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (process.env.NODE_ENV !== 'production' && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const port = Number(process.env.MOCK_PLATFORM_PORT ?? 4100);
// Varsayılan olarak sadece bu bilgisayardan erişilir; yerel ağdaki cihazlara açılmaz.
const host = process.env.MOCK_PLATFORM_HOST ?? '127.0.0.1';
const app = buildServer({ logger: true });

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
