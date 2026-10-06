import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadOrCreateKeys } from './keys.js';
import { BIST_MARKETS, PriceSimulator } from './prices.js';
import { RealPriceFeed } from './real-prices.js';
import { buildServer } from './server.js';
import { assertWebhookSecretSafe, DEV_WEBHOOK_SECRET, WebhookSender } from './webhooks.js';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (process.env.NODE_ENV !== 'production' && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const port = Number(process.env.MOCK_PLATFORM_PORT ?? 4100);
// Varsayılan olarak sadece bu bilgisayardan erişilir; yerel ağdaki cihazlara açılmaz.
const host = process.env.MOCK_PLATFORM_HOST ?? '127.0.0.1';
const issuer = process.env.MOCK_PLATFORM_ISSUER ?? 'mock-platform';
const webUrl = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

const keys = loadOrCreateKeys(fileURLToPath(new URL('../keys/', import.meta.url)));
const prices = new PriceSimulator();

/**
 * Demo için gerçek kripto fiyatı (8. adım). Varsayılan kapalı: sahte fiyatla çalışır, dışarı istek
 * gitmez. `MOCK_PLATFORM_PRICE_MODE=real` ile açılır; kaynak susarsa son fiyat, hiç gelmediyse
 * simülasyon yayınlanır.
 */
const realPriceMode = (process.env.MOCK_PLATFORM_PRICE_MODE ?? 'simulated') === 'real';
const realPrices = realPriceMode
  ? new RealPriceFeed(prices, {
      url: process.env.MOCK_PLATFORM_REAL_PRICE_URL,
      refreshMs: Number(process.env.MOCK_PLATFORM_REAL_PRICE_REFRESH_MS ?? 2000),
    })
  : undefined;
const ligApiUrl = process.env.LIG_API_URL ?? 'http://127.0.0.1:4000';
const webhookSecret = process.env.MOCK_PLATFORM_WEBHOOK_SECRET ?? DEV_WEBHOOK_SECRET;
assertWebhookSecretSafe(webhookSecret, webUrl, process.env.NODE_ENV);
const webhooks = new WebhookSender({ url: `${ligApiUrl}/webhooks/platform`, issuer, secret: webhookSecret });
const app = await buildServer({ keys, issuer, webUrl, prices, realPrices, webhooks, logger: true });

// Fiyatlar saniyede bir hareket eder. Gerçek modda simülatör de dönmeye devam eder: kaynak hiç
// cevap vermezse yayınlanan yedek fiyatlar donuk kalmaz.
const ticker = setInterval(() => prices.tick(), 1000);
app.addHook('onClose', async () => clearInterval(ticker));

if (realPrices) {
  app.log.info(`Real price mode on: ${process.env.MOCK_PLATFORM_REAL_PRICE_URL ?? 'varsayılan kaynak'}`);
  void realPrices.refresh();
  const realTicker = setInterval(() => void realPrices.refresh(), 1000);
  app.addHook('onClose', async () => clearInterval(realTicker));
}

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
assertWebhookSecretSafe(brokerSecret, webUrl, process.env.NODE_ENV);
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
