import { type PlatformEventWebhook } from '@lig/shared';

export interface WebhookTenant {
  tenantId: string;
  secret: string;
}

export interface PlatformEventStore {
  /** Webhook anahtarı tanımlı platformu `iss` değeriyle bulur. */
  findTenant(issuer: string): Promise<WebhookTenant | null>;
  /**
   * Olayı kaydeder. Aynı olay kimliği daha önce geldiyse hiçbir şey yazmaz ve `duplicate: true` döner.
   * Oyuncu ligi daha önce açmışsa görev olayı (outbox) aynı transaction'da yazılır.
   */
  record(
    tenantId: string,
    event: PlatformEventWebhook,
  ): Promise<{ duplicate: boolean; playerKnown: boolean }>;
}

export const PLATFORM_EVENT_STORE = Symbol('PLATFORM_EVENT_STORE');
