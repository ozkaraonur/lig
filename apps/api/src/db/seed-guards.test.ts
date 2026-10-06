import { describe, expect, it } from 'vitest';
import {
  assertSeedSecretsSafe,
  DEV_ADMIN_PASSWORD,
  DEV_WEBHOOK_SECRET,
  MIN_PUBLIC_SECRET_LENGTH,
} from './seed-guards';

const strong = 'x'.repeat(MIN_PUBLIC_SECRET_LENGTH);

describe('assertSeedSecretsSafe', () => {
  it('lets the well-known development values through on a local setup', () => {
    expect(() =>
      assertSeedSecretsSafe({
        publicDeploy: false,
        webhookSecret: DEV_WEBHOOK_SECRET,
        adminPassword: DEV_ADMIN_PASSWORD,
      }),
    ).not.toThrow();
  });

  it('refuses the development webhook secret and admin password on a public setup', () => {
    expect(() =>
      assertSeedSecretsSafe({ publicDeploy: true, webhookSecret: DEV_WEBHOOK_SECRET, adminPassword: strong }),
    ).toThrow('webhook');
    expect(() =>
      assertSeedSecretsSafe({ publicDeploy: true, webhookSecret: strong, adminPassword: DEV_ADMIN_PASSWORD }),
    ).toThrow('SEED_ADMIN_PASSWORD');
  });

  it('refuses short values on a public setup', () => {
    const short = 'x'.repeat(MIN_PUBLIC_SECRET_LENGTH - 1);
    expect(() =>
      assertSeedSecretsSafe({ publicDeploy: true, webhookSecret: short, adminPassword: strong }),
    ).toThrow('webhook');
    expect(() =>
      assertSeedSecretsSafe({ publicDeploy: true, webhookSecret: strong, adminPassword: short }),
    ).toThrow('SEED_ADMIN_PASSWORD');
  });

  it('accepts strong values on a public setup and never echoes them', () => {
    expect(() =>
      assertSeedSecretsSafe({ publicDeploy: true, webhookSecret: strong, adminPassword: strong }),
    ).not.toThrow();
    try {
      assertSeedSecretsSafe({ publicDeploy: true, webhookSecret: 'kisa-gizli', adminPassword: strong });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain('kisa-gizli');
    }
  });
});
