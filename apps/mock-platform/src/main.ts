import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadOrCreateKeys } from './keys.js';
import { BIST_MARKETS, PriceSimulator } from './prices.js';
import { buildServer } from './server.js';
import { DEV_WEBHOOK_SECRET, WebhookSender } from './webhooks.js';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (process.env.NODE_ENV !== 'production' && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const port = Number(process.env.MOCK_PLATFORM_PORT ?? 4100);
// Varsayılan olarak sadece bu bilgisayardan erişilir; yerel ağdaki cihazlara açılmaz.
const host = process.env.MOCK_PLATFORM_HOST ?? '127.0.0.1';
const issuer = process.env.MOCK_PLATFORM_ISSUER ?? 'mock-platform';
const webUrl = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

const keys = loadOrCreateKeys(fileURLToPath(new URL('../keys/', import.meta.url)));
const prices = new PriceSimulator();
const ligApiUrl = process.env.LIG_API_URL ?? 'http://127.0.0.1:4000';
const webhookSecret = process.env.MOCK_PLATFORM_WEBHOOK_SECRET ?? DEV_WEBHOOK_SECRET;
if (process.env.NODE_ENV === 'production' && webhookSecret === DEV_WEBHOOK_SECRET) {
  throw new Error('MOCK_PLATFORM_WEBHOOK_SECRET must be set in production');
}
const webhooks = new WebhookSender({ url: `${ligApiUrl}/webhooks/platform`, issuer, secret: webhookSecret });
const app = await buildServer({ keys, issuer, webUrl, prices, webhooks, logger: true });

// Fiyatlar saniyede bir hareket eder.
const ticker = setInterval(() => prices.tick(), 1000);
app.addHook('onClose', async () => clearInterval(ticker));

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

/**
 * İkinci sahte müşteri: "Sahte Aracı Kurum" (Faz 2, 7. adım). Aynı uygulama, ayrı issuer, ayrı anahtar
 * çifti ve ayrı port. BIST hisseleri yayınlar; lig tarafında seans saati ve tavan/taban kuralları işler.
 */
const brokerPort = Number(process.env.MOCK_BROKER_PORT ?? 4200);
const brokerIssuer = process.env.MOCK_BROKER_ISSUER ?? 'mock-broker';
const brokerKeys = loadOrCreateKeys(fileURLToPath(new URL('../keys-broker/', import.meta.url)));
const brokerPrices = new PriceSimulator(BIST_MARKETS);
const brokerSecret = process.env.MOCK_BROKER_WEBHOOK_SECRET ?? DEV_WEBHOOK_SECRET;
const brokerWebhooks = new WebhookSender({
  url: `${ligApiUrl}/webhooks/platform`,
  issuer: brokerIssuer,
  secret: brokerSecret,
});
const brokerApp = await buildServer({
  keys: brokerKeys,
  issuer: brokerIssuer,
  webUrl,
  prices: brokerPrices,
  webhooks: brokerWebhooks,
  brandName: 'Sahte Aracı Kurum',
  brandIntro: 'Gerçek bir aracı kurumun yerine geçer. BIST hisseleriyle sanal lig, açık tema.',
  logger: true,
});

// Seans dışında fiyat üretmeye devam eder; lig API'si seans kapalıyken bu fiyatları saklamaz.
const brokerTicker = setInterval(() => brokerPrices.tick(), 1000);
brokerApp.addHook('onClose', async () => clearInterval(brokerTicker));

try {
  await brokerApp.listen({ port: brokerPort, host });
} catch (err) {
  brokerApp.log.error(err);
  process.exit(1);
}
