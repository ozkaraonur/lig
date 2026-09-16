import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadOrCreateKeys } from './keys.js';
import { PriceSimulator } from './prices.js';
import { buildServer } from './server.js';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (process.env.NODE_ENV !== 'production' && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const port = Number(process.env.MOCK_PLATFORM_PORT ?? 4100);
// Varsayılan olarak sadece bu bilgisayardan erişilir; yerel ağdaki cihazlara açılmaz.
const host = process.env.MOCK_PLATFORM_HOST ?? '127.0.0.1';
const issuer = process.env.MOCK_PLATFORM_ISSUER ?? 'mock-platform';
const webUrl = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

const keys = loadOrCreateKeys(fileURLToPath(new URL('../keys/', import.meta.url)));
const prices = new PriceSimulator();
const app = await buildServer({ keys, issuer, webUrl, prices, logger: true });

// Fiyatlar saniyede bir hareket eder.
const ticker = setInterval(() => prices.tick(), 1000);
app.addHook('onClose', async () => clearInterval(ticker));

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
