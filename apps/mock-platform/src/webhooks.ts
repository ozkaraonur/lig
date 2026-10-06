import { createHmac, randomUUID } from 'node:crypto';
import { type PlatformEventWebhook, WEBHOOK_HEADERS } from '@lig/shared';

/** Yalnızca yerel geliştirme için. Üretimde her platformun kendi rastgele anahtarı olur. */
export const DEV_WEBHOOK_SECRET = 'dev-only-webhook-secret-change-me';

/** Adres bu bilgisayara mı ait (localhost, 127.x.x.x, ::1)? */
function isLoopbackUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}

/**
 * Üretimde ya da herkese açık bir adreste (tünelle açılan demo, K-037) depodaki bilinen geliştirme sırrı
 * kabul edilmez: onu bilen herkes sahte bir "gerçek işlem" bildirimi gönderebilirdi.
 */
export function assertWebhookSecretSafe(secret: string, webUrl: string, nodeEnv: string | undefined): void {
  const publicDeploy = nodeEnv === 'production' || !isLoopbackUrl(webUrl);
  if (publicDeploy && secret === DEV_WEBHOOK_SECRET) {
    throw new Error('Herkese açık kurulumda webhook sırrı geliştirme değeri olamaz.');
  }
}

export interface WebhookSenderOptions {
  /** Lig API'sinin webhook adresi, ör. http://127.0.0.1:4000/webhooks/platform */
  url: string;
  issuer: string;
  secret: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface DeliveryResult {
  eventId: string;
  status: number;
  body: unknown;
}

/**
 * Gerçek platformun "oyuncu gerçek işlem yaptı" bildirimini taklit eder (FR-31). İmza biçimi lig API'sindeki
 * doğrulamayla aynıdır: HMAC-SHA256(anahtar, "<unix saniye>.<ham gövde>").
 */
export class WebhookSender {
  private last: PlatformEventWebhook | null = null;

  constructor(private readonly options: WebhookSenderOptions) {}

  realTrade(playerId: string): Promise<DeliveryResult> {
    const now = (this.options.now ?? Date.now)();
    const event: PlatformEventWebhook = {
      eventId: `evt_${randomUUID()}`,
      type: 'real_trade',
      playerId,
      occurredAt: new Date(now).toISOString(),
    };
    this.last = event;
    return this.deliver(event);
  }

  /** Son olayı aynı kimlikle, yeni imza ve zaman damgasıyla tekrar gönderir (tekrar koruması testi). */
  replayLast(): Promise<DeliveryResult> | null {
    return this.last ? this.deliver(this.last) : null;
  }

  private async deliver(event: PlatformEventWebhook): Promise<DeliveryResult> {
    const body = JSON.stringify(event);
    const timestamp = String(Math.floor((this.options.now ?? Date.now)() / 1000));
    const signature = `v1=${createHmac('sha256', this.options.secret).update(`${timestamp}.${body}`).digest('hex')}`;
    const res = await (this.options.fetch ?? fetch)(this.options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_HEADERS.issuer]: this.options.issuer,
        [WEBHOOK_HEADERS.timestamp]: timestamp,
        [WEBHOOK_HEADERS.signature]: signature,
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    return { eventId: event.eventId, status: res.status, body: await res.json().catch(() => null) };
  }
}
