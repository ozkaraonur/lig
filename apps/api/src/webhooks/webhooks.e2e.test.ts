import { randomUUID } from 'node:crypto';
import { type PlatformEventWebhook, WEBHOOK_HEADERS } from '@lig/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../app.setup';
import { CLOCK_MS } from '../common/clock';
import { developmentKeyring, LocalSecretCipher } from '../secrets/local-secret-cipher';
import { SECRET_CIPHER, secretContext } from '../secrets/secret-cipher';
import { PLATFORM_EVENT_STORE, type PlatformEventStore } from './ports';
import { signWebhook, verifyWebhookSignature } from './webhook-signature';
import { MAX_EVENT_AGE_DAYS, WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';

const NOW = Date.parse('2026-09-17T09:00:00Z');
const SECRET = 'test-webhook-secret';
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const cipher = new LocalSecretCipher(developmentKeyring());

class FakeStore implements PlatformEventStore {
  readonly events = new Map<string, PlatformEventWebhook>();
  secretCiphertext = '';
  async findTenant(issuer: string) {
    return issuer === 'platform-a' ? { tenantId: TENANT, secretCiphertext: this.secretCiphertext } : null;
  }
  async record(_tenantId: string, event: PlatformEventWebhook) {
    const duplicate = this.events.has(event.eventId);
    if (!duplicate) this.events.set(event.eventId, event);
    return { duplicate, playerKnown: true };
  }
}

let app: NestFastifyApplication;
let store: FakeStore;

beforeEach(async () => {
  store = new FakeStore();
  store.secretCiphertext = await cipher.encrypt(SECRET, secretContext.tenantWebhookSecret(TENANT));
  const moduleRef = await Test.createTestingModule({
    controllers: [WebhooksController],
    providers: [
      WebhooksService,
      { provide: CLOCK_MS, useValue: () => NOW },
      { provide: PLATFORM_EVENT_STORE, useValue: store },
      { provide: SECRET_CIPHER, useValue: cipher },
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { rawBody: true });
  await configureApp(app, { webOrigin: 'http://localhost:3000' });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterEach(async () => {
  await app.close();
});

function event(overrides: Partial<PlatformEventWebhook> = {}): PlatformEventWebhook {
  return {
    eventId: `evt_${randomUUID()}`,
    type: 'real_trade',
    playerId: 'oyuncu-1',
    occurredAt: new Date(NOW - 60_000).toISOString(),
    ...overrides,
  };
}

interface SendOptions {
  body?: string;
  issuer?: string;
  timestamp?: string;
  secret?: string;
  signature?: string;
}

function send(payload: unknown, o: SendOptions = {}) {
  const body = o.body ?? JSON.stringify(payload);
  const timestamp = o.timestamp ?? String(Math.floor(NOW / 1000));
  return app.inject({
    method: 'POST',
    url: '/webhooks/platform',
    headers: {
      'content-type': 'application/json',
      [WEBHOOK_HEADERS.issuer]: o.issuer ?? 'platform-a',
      [WEBHOOK_HEADERS.timestamp]: timestamp,
      [WEBHOOK_HEADERS.signature]: o.signature ?? signWebhook(o.secret ?? SECRET, timestamp, body),
    },
    payload: body,
  });
}

describe('webhook signature helpers', () => {
  it('verifies its own signature and rejects any change', () => {
    const sig = signWebhook(SECRET, '100', '{"a":1}');
    expect(verifyWebhookSignature(SECRET, '100', Buffer.from('{"a":1}'), sig)).toBe(true);
    expect(verifyWebhookSignature(SECRET, '101', Buffer.from('{"a":1}'), sig)).toBe(false);
    expect(verifyWebhookSignature(SECRET, '100', Buffer.from('{"a": 1}'), sig)).toBe(false);
    expect(verifyWebhookSignature('other', '100', Buffer.from('{"a":1}'), sig)).toBe(false);
    expect(verifyWebhookSignature(SECRET, '100', Buffer.from('{"a":1}'), sig.toUpperCase())).toBe(false);
    expect(verifyWebhookSignature(SECRET, '100', Buffer.from('{"a":1}'), 'v1=abc')).toBe(false);
  });
});

describe('POST /webhooks/platform (FR-31, T5)', () => {
  it('accepts a correctly signed event', async () => {
    const e = event();
    const res = await send(e);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ received: true, duplicate: false });
    expect(store.events.get(e.eventId)).toEqual(e);
  });

  it('acknowledges a replayed event id without recording it twice', async () => {
    const e = event();
    await send(e);
    const again = await send(e);
    expect(again.statusCode).toBe(202);
    expect(again.json()).toEqual({ received: true, duplicate: true });
    expect(store.events.size).toBe(1);
  });

  it.each([
    ['a wrong secret', { secret: 'guessed-secret' }],
    ['another platform issuer', { issuer: 'platform-b' }],
    ['a missing signature', { signature: '' }],
    ['a malformed signature', { signature: 'sha256=deadbeef' }],
    ['a timestamp older than 5 minutes', { timestamp: String(Math.floor(NOW / 1000) - 301) }],
    ['a timestamp from the future', { timestamp: String(Math.floor(NOW / 1000) + 301) }],
    ['a non-numeric timestamp', { timestamp: '1e9' }],
  ])('rejects %s with a generic 401 and records nothing', async (_label, options) => {
    const res = await send(event(), options);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'UNAUTHENTICATED', message: 'Webhook imzası doğrulanamadı.' });
    expect(store.events.size).toBe(0);
  });

  it('rejects with the same generic 401 when the stored secret belongs to another tenant row', async () => {
    // Veritabanına yazabilen biri başka tenant'ın şifreli anahtarını bu satıra kopyalamış olsun (K-015).
    store.secretCiphertext = await cipher.encrypt(SECRET, secretContext.tenantWebhookSecret('other-tenant'));
    const res = await send(event());
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'UNAUTHENTICATED', message: 'Webhook imzası doğrulanamadı.' });
    expect(store.events.size).toBe(0);
  });

  it('rejects a body changed after signing (e.g. swapping the player)', async () => {
    const original = JSON.stringify(event({ playerId: 'oyuncu-1' }));
    const timestamp = String(Math.floor(NOW / 1000));
    const signature = signWebhook(SECRET, timestamp, original);
    const tampered = original.replace('oyuncu-1', 'oyuncu-2');
    const res = await send(null, { body: tampered, timestamp, signature });
    expect(res.statusCode).toBe(401);
  });

  it('rejects malformed JSON without recording anything', async () => {
    // Fastify, gövdeyi prototype pollution korumalı ayrıştırıcıyla (secure-json-parse) imzadan önce okur ve
    // bozuk JSON'u 400 ile keser. İş kuralları ve kayıt yine de yalnızca imza doğrulandıktan sonra çalışır.
    const res = await send(null, { body: '{not json', secret: 'wrong' });
    expect(res.statusCode).toBe(400);
    expect(store.events.size).toBe(0);
  });

  it.each([
    ['unknown fields', { ...event(), tenantId: 'other' }],
    ['an unknown type', { ...event(), type: 'deposit' }],
    ['an injected player id', { ...event(), playerId: "x' OR 1=1 --" }],
  ])('rejects a signed body with %s as 400', async (_label, payload) => {
    const res = await send(payload);
    expect(res.statusCode).toBe(400);
    expect(store.events.size).toBe(0);
  });

  it.each([
    ['in the future', new Date(NOW + 10 * 60_000)],
    ['older than the retention window', new Date(NOW - (MAX_EVENT_AGE_DAYS + 1) * 86_400_000)],
  ])('rejects an event that occurred %s', async (_label, when) => {
    const res = await send(event({ occurredAt: when.toISOString() }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ message: 'Geçersiz alanlar: occurredAt' });
  });

  it('never needs a session cookie', async () => {
    expect((await send(event())).statusCode).toBe(202);
  });
});
