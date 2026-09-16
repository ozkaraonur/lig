import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchJsonLimited, type HttpFeedOptions } from './http-feed.client';

let server: FastifyInstance;
let base: string;
const options: HttpFeedOptions = { timeoutMs: 300, maxBytes: 1024, allowHttp: true };

beforeAll(async () => {
  server = Fastify();
  server.get('/ok', async () => ({ ticks: [] }));
  server.get('/redirect', async (_req, reply) => reply.redirect('http://169.254.169.254/latest/meta-data'));
  server.get('/slow', async () => {
    await new Promise((r) => setTimeout(r, 1_000));
    return { ticks: [] };
  });
  server.get('/big', async (_req, reply) => reply.type('application/json').send(`"${'x'.repeat(4096)}"`));
  server.get('/big-chunked', async (_req, reply) => {
    const { Readable } = await import('node:stream');
    // content-length olmadan, parça parça gönderilen büyük yanıt
    return reply
      .type('application/json')
      .send(Readable.from(Array.from({ length: 50 }, () => 'x'.repeat(100))));
  });
  server.get('/not-json', async (_req, reply) => reply.type('text/plain').send('<html>'));
  server.get('/error', async (_req, reply) => reply.status(503).send({ message: 'down' }));
  base = await server.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await server.close();
});

describe('fetchJsonLimited', () => {
  it('returns parsed json', async () => {
    expect(await fetchJsonLimited(`${base}/ok`, options)).toEqual({ ticks: [] });
  });

  it('refuses to follow redirects (SSRF)', async () => {
    await expect(fetchJsonLimited(`${base}/redirect`, options)).rejects.toThrow('network error');
  });

  it('times out slow feeds', async () => {
    await expect(fetchJsonLimited(`${base}/slow`, options)).rejects.toThrow('timeout');
  });

  it('rejects responses larger than the limit by content-length', async () => {
    await expect(fetchJsonLimited(`${base}/big`, options)).rejects.toThrow('response too large');
  });

  it('rejects streamed responses that grow past the limit', async () => {
    await expect(fetchJsonLimited(`${base}/big-chunked`, options)).rejects.toThrow('response too large');
  });

  it('rejects non-json bodies and error statuses', async () => {
    await expect(fetchJsonLimited(`${base}/not-json`, options)).rejects.toThrow('not valid json');
    await expect(fetchJsonLimited(`${base}/error`, options)).rejects.toThrow('unexpected status 503');
  });

  it.each(['file:///etc/passwd', 'gopher://127.0.0.1:6379/_FLUSHALL', 'not a url'])(
    'rejects %s',
    async (url) => {
      await expect(fetchJsonLimited(url, options)).rejects.toThrow();
    },
  );

  it('requires https when plain http is not allowed', async () => {
    await expect(fetchJsonLimited(`${base}/ok`, { ...options, allowHttp: false })).rejects.toThrow(
      'protocol not allowed: http:',
    );
  });

  it('rejects credentials embedded in the url', async () => {
    const withCreds = base.replace('http://', 'http://user:pass@');
    await expect(fetchJsonLimited(`${withCreds}/ok`, options)).rejects.toThrow('credentials');
  });
});
