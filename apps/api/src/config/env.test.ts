import { describe, expect, it } from 'vitest';
import { isLoopbackOrigin, isTrustedProxyAddress, parseEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://lig:secret@localhost:5432/lig',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.API_HOST).toBe('127.0.0.1');
    expect(env.NODE_ENV).toBe('development');
    expect(env.WEB_ORIGIN).toBe('http://localhost:3000');
    expect(env.WORKERS_ENABLED).toBe(true);
    expect(env.PRICE_POLL_INTERVAL_MS).toBe(1000);
  });

  it('parses WORKERS_ENABLED as a boolean, not a truthy string', () => {
    expect(parseEnv({ ...base, WORKERS_ENABLED: 'false' }).WORKERS_ENABLED).toBe(false);
    expect(() => parseEnv({ ...base, WORKERS_ENABLED: 'maybe' })).toThrow('WORKERS_ENABLED');
  });

  it('refuses a price poll interval that would hammer the platform', () => {
    expect(() => parseEnv({ ...base, PRICE_POLL_INTERVAL_MS: '10' })).toThrow('PRICE_POLL_INTERVAL_MS');
  });

  it('rejects a non-postgres database url', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: 'mysql://x@localhost/db' })).toThrow('DATABASE_URL');
  });

  it('never includes secret values in the error message', () => {
    try {
      parseEnv({ DATABASE_URL: 'postgres://lig:super-secret@localhost/lig', REDIS_URL: 'not a url' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('REDIS_URL');
      expect((e as Error).message).not.toContain('super-secret');
    }
  });

  it('requires SECRET_KEYS in production and validates its shape without echoing it', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow('SECRET_KEYS');
    const key = Buffer.alloc(32, 7).toString('base64');
    expect(parseEnv({ ...base, NODE_ENV: 'production', SECRET_KEYS: `k1:${key}` }).SECRET_KEYS).toBe(
      `k1:${key}`,
    );
    try {
      parseEnv({ ...base, SECRET_KEYS: 'k1:c2hvcnQta2V5LXZhbHVl' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('SECRET_KEYS');
      expect((e as Error).message).not.toContain('c2hvcnQta2V5LXZhbHVl');
    }
  });

  it('treats an empty SECRET_KEYS as unset in development', () => {
    expect(parseEnv({ ...base, SECRET_KEYS: '' }).SECRET_KEYS).toBeUndefined();
  });

  it('requires SECRET_KEYS for a public origin even outside production (tunnel demo, K-037)', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const publicOrigin = { ...base, WEB_ORIGIN: 'https://web.ornek.dev' };
    expect(() => parseEnv(publicOrigin)).toThrow('SECRET_KEYS');
    expect(parseEnv({ ...publicOrigin, SECRET_KEYS: `k1:${key}` }).WEB_ORIGIN).toBe('https://web.ornek.dev');
    // Yerel adreslerde geliştirme anahtarı serbest kalır.
    expect(parseEnv({ ...base, WEB_ORIGIN: 'http://127.0.0.1:3000' }).SECRET_KEYS).toBeUndefined();
  });

  it('reads TRUST_PROXY as a list of addresses and rejects anything else', () => {
    expect(parseEnv(base).TRUST_PROXY).toEqual([]);
    expect(parseEnv({ ...base, TRUST_PROXY: '127.0.0.1, ::1' }).TRUST_PROXY).toEqual(['127.0.0.1', '::1']);
    for (const bad of ['*', 'true', 'cloudflare.com', '127.0.0.1/99', '10.0.0.0/8/8', '127.0.0.1,']) {
      expect(() => parseEnv({ ...base, TRUST_PROXY: bad }), bad).toThrow('TRUST_PROXY');
    }
  });
});

describe('isTrustedProxyAddress', () => {
  it('accepts IPs and CIDR ranges only', () => {
    for (const ok of ['127.0.0.1', '::1', '10.0.0.0/8', 'fd00::/8'])
      expect(isTrustedProxyAddress(ok), ok).toBe(true);
    for (const bad of ['', 'localhost', '300.1.1.1', '10.0.0.0/33', '::1/129', '10.0.0.0/x']) {
      expect(isTrustedProxyAddress(bad), bad).toBe(false);
    }
  });
});

describe('isLoopbackOrigin', () => {
  it('accepts only addresses of this machine', () => {
    for (const o of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      expect(isLoopbackOrigin(o), o).toBe(true);
    }
    // Yerel gibi görünen ama başka bir alan adına ait adresler yerel sayılmaz.
    for (const o of ['https://web.ornek.dev', 'http://localhost.ornek.dev', 'http://127.0.0.1.ornek.dev']) {
      expect(isLoopbackOrigin(o), o).toBe(false);
    }
  });
});
