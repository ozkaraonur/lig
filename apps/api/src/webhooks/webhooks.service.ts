import { Inject, Injectable, Logger } from '@nestjs/common';
import { platformEventWebhook, WEBHOOK_TOLERANCE_SECONDS } from '@lig/shared';
import { AppError } from '../common/app-error';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { PLATFORM_EVENT_STORE, type PlatformEventStore } from './ports';
import { verifyWebhookSignature } from './webhook-signature';

/** Platformun geriye dönük gönderebileceği en eski olay (ör. kuyruğunda bekleyen yeniden denemeler). */
export const MAX_EVENT_AGE_DAYS = 7;

const rejected = () => new AppError('UNAUTHENTICATED', 401, 'Webhook imzası doğrulanamadı.');

export interface WebhookHeaders {
  issuer?: string;
  timestamp?: string;
  signature?: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(PLATFORM_EVENT_STORE) private readonly store: PlatformEventStore,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  /**
   * FR-31, T5. Sıra önemli: gövde, imza doğrulanmadan ayrıştırılmaz ve hiçbir şey yazılmaz.
   * Her ret aynı genel yanıtı alır; sebep yalnızca sunucu loguna gider.
   */
  async receive(headers: WebhookHeaders, rawBody: Buffer | undefined): Promise<{ duplicate: boolean }> {
    const { issuer, timestamp, signature } = headers;
    if (!issuer || !timestamp || !signature || !rawBody) return this.reject('missing_parts');

    const tenant = await this.store.findTenant(issuer);
    if (!tenant) return this.reject('unknown_issuer');

    if (!/^\d{1,12}$/.test(timestamp)) return this.reject('bad_timestamp');
    const nowSeconds = Math.floor(this.clock() / 1000);
    if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS)
      return this.reject('stale_timestamp');

    if (!verifyWebhookSignature(tenant.secret, timestamp, rawBody, signature))
      return this.reject('bad_signature');

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new AppError('VALIDATION_FAILED', 400, 'Geçersiz alanlar: body');
    }
    const parsed = platformEventWebhook.safeParse(json);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || 'body'))].join(', ');
      throw new AppError('VALIDATION_FAILED', 400, `Geçersiz alanlar: ${fields}`);
    }

    const occurredAt = Date.parse(parsed.data.occurredAt);
    const now = this.clock();
    if (
      occurredAt > now + WEBHOOK_TOLERANCE_SECONDS * 1000 ||
      occurredAt < now - MAX_EVENT_AGE_DAYS * 86_400_000
    ) {
      throw new AppError('VALIDATION_FAILED', 400, 'Geçersiz alanlar: occurredAt');
    }

    const result = await this.store.record(tenant.tenantId, parsed.data);
    return { duplicate: result.duplicate };
  }

  private reject(reason: string): never {
    // İmza, gövde ve anahtar loglanmaz.
    this.logger.warn(`Platform webhook rejected: ${reason}`);
    throw rejected();
  }
}
