import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { trustProxyOption } from './app.setup';

/** Verilen güvenilir vekil listesiyle bir istek atar ve Fastify'ın `request.ip` olarak gördüğü adresi döndürür. */
async function seenIp(trusted: string[], forwardedFor: string): Promise<string> {
  const app = Fastify({ trustProxy: trustProxyOption(trusted) });
  app.get('/ip', async (request) => ({ ip: request.ip }));
  const res = await app.inject({
    method: 'GET',
    url: '/ip',
    remoteAddress: '127.0.0.1',
    headers: { 'x-forwarded-for': forwardedFor },
  });
  await app.close();
  return (res.json() as { ip: string }).ip;
}

describe('trustProxyOption', () => {
  it('maps an empty list to "no proxy"', () => {
    expect(trustProxyOption([])).toBe(false);
    expect(trustProxyOption(['127.0.0.1'])).toEqual(['127.0.0.1']);
  });

  it('ignores X-Forwarded-For entirely when there is no proxy', async () => {
    expect(await seenIp([], '203.0.113.7')).toBe('127.0.0.1');
  });

  it('takes the address the trusted proxy saw, not what the client wrote', async () => {
    // Soldaki 9.9.9.9 istemcinin uydurduğu değer; sağdaki 203.0.113.7 tünelin gördüğü gerçek adres.
    expect(await seenIp(['127.0.0.1'], '9.9.9.9, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('does not trust the header when the connection is not from a trusted proxy', async () => {
    // Doğrudan internetten gelen biri (güvenilmeyen adres) başlığa istediğini yazamaz.
    expect(await seenIp(['10.0.0.0/8'], '9.9.9.9, 203.0.113.7')).toBe('127.0.0.1');
  });
});
