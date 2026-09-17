import { createHmac } from 'node:crypto';
import { platformEventWebhook, WEBHOOK_HEADERS } from '@lig/shared';
import { describe, expect, it } from 'vitest';
import { WebhookSender } from './webhooks.js';

describe('WebhookSender', () => {
  function capture() {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ received: true }), { status: 202 });
    }) as unknown as typeof fetch;
    return { calls, fakeFetch };
  }

  it('sends a schema-valid event signed over the timestamp and raw body', async () => {
    const { calls, fakeFetch } = capture();
    const sender = new WebhookSender({
      url: 'http://api.test/webhooks/platform',
      issuer: 'mock',
      secret: 's3cret',
      fetch: fakeFetch,
      now: () => 1_800_000_000_000,
    });
    const result = await sender.realTrade('oyuncu-1');
    expect(result.status).toBe(202);

    const { init } = calls[0]!;
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    expect(platformEventWebhook.parse(JSON.parse(body))).toMatchObject({
      type: 'real_trade',
      playerId: 'oyuncu-1',
    });
    expect(headers[WEBHOOK_HEADERS.timestamp]).toBe('1800000000');
    const expected = createHmac('sha256', 's3cret').update(`1800000000.${body}`).digest('hex');
    expect(headers[WEBHOOK_HEADERS.signature]).toBe(`v1=${expected}`);
  });

  it('replays the last event with the same id', async () => {
    const { calls, fakeFetch } = capture();
    const sender = new WebhookSender({ url: 'http://x', issuer: 'mock', secret: 's', fetch: fakeFetch });
    expect(sender.replayLast()).toBeNull();
    const first = await sender.realTrade('p1');
    const again = await sender.replayLast();
    expect(again?.eventId).toBe(first.eventId);
    expect(JSON.parse(calls[1]!.init.body as string).eventId).toBe(first.eventId);
  });
});
