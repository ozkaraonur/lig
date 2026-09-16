import { describe, expect, it } from 'vitest';
import { HealthService } from './health.service';

const okPool = { query: async () => ({ rows: [{ '?column?': 1 }] }) } as never;
const failPool = {
  query: async () => {
    throw new Error('connection refused');
  },
} as never;
const okRedis = { ping: async () => 'PONG' } as never;
const failRedis = {
  ping: async () => {
    throw new Error('connection refused');
  },
} as never;

describe('HealthService', () => {
  it('reports up when both dependencies respond', async () => {
    const report = await new HealthService(okPool, okRedis).check();
    expect(report).toEqual({ status: 'up', checks: { database: 'up', redis: 'up' } });
  });

  it('reports down when the database fails', async () => {
    const report = await new HealthService(failPool, okRedis).check();
    expect(report.status).toBe('down');
    expect(report.checks.database).toBe('down');
    expect(report.checks.redis).toBe('up');
  });

  it('reports down when redis fails', async () => {
    const report = await new HealthService(okPool, failRedis).check();
    expect(report.status).toBe('down');
    expect(report.checks.redis).toBe('down');
  });
});
