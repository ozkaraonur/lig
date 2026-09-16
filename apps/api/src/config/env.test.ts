import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

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
});
