import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { type PriceFeedClient } from './ports';

export const FEED_TIMEOUT_MS = 2_000;
export const FEED_MAX_BYTES = 256 * 1024;

export class PriceFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceFeedError';
  }
}

export interface HttpFeedOptions {
  timeoutMs: number;
  maxBytes: number;
  /** Yalnızca yerel geliştirmede http kabul edilir; üretimde fiyat akışı https olmak zorunda. */
  allowHttp: boolean;
}

/**
 * Platformun fiyat uç noktasını okur. Kendi başına güvenlik sınırlarını uygular:
 * - http(s) dışındaki protokoller reddedilir (file:, gopher: vb.), üretimde yalnızca https.
 * - Yönlendirme takip edilmez: izin verilen adres başka bir iç adrese yönlendiremez (SSRF).
 * - Zaman aşımı ve gövde boyutu sınırı: yavaş ya da dev yanıt alıcıyı kilitleyemez (T9).
 */
export async function fetchJsonLimited(rawUrl: string, options: HttpFeedOptions): Promise<unknown> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PriceFeedError('invalid feed url');
  }
  const allowed = options.allowHttp ? ['https:', 'http:'] : ['https:'];
  if (!allowed.includes(url.protocol)) throw new PriceFeedError(`protocol not allowed: ${url.protocol}`);
  if (url.username || url.password) throw new PriceFeedError('credentials in feed url are not allowed');

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network error';
    throw new PriceFeedError(reason);
  }

  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new PriceFeedError(`unexpected status ${res.status}`);
  }

  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new PriceFeedError('response too large');
  }

  const text = await readLimited(res, options.maxBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PriceFeedError('response is not valid json');
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PriceFeedError('response too large');
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof PriceFeedError) throw err;
    throw new PriceFeedError('response read failed');
  }
  return Buffer.concat(chunks).toString('utf8');
}

@Injectable()
export class HttpPriceFeedClient implements PriceFeedClient {
  private readonly options: HttpFeedOptions;

  constructor(@Inject(ENV) env: Env) {
    this.options = {
      timeoutMs: FEED_TIMEOUT_MS,
      maxBytes: FEED_MAX_BYTES,
      allowHttp: env.NODE_ENV !== 'production',
    };
  }

  fetchJson(url: string): Promise<unknown> {
    return fetchJsonLimited(url, this.options);
  }
}
