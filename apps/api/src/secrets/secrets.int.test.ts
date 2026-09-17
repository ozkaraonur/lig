import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../admin-auth/password-hasher';
import { adminUsers, tenants } from '../db/schema';
import { connectIntegration, createTenant, deleteTenants } from '../test/integration.test-utils';
import { DrizzlePlatformEventStore } from '../webhooks/drizzle-platform-events';
import { LocalSecretCipher, parseKeyring } from './local-secret-cipher';
import { rotateStoredSecrets } from './rotate-secrets';
import { secretContext } from './secret-cipher';

const ctx = connectIntegration();
let tenantId: string;
let adminId: string;
const issuer = `secrets-${randomBytes(4).toString('hex')}`;
const k1 = `k1:${randomBytes(32).toString('base64')}`;
const k2 = `k2:${randomBytes(32).toString('base64')}`;
const oldCipher = new LocalSecretCipher(parseKeyring(k1));
const newCipher = new LocalSecretCipher(parseKeyring(`${k2},${k1}`));

beforeAll(async () => {
  tenantId = await createTenant(ctx.db, 'secrets');
  await ctx.db
    .update(tenants)
    .set({
      ssoIssuer: issuer,
      webhookSecretCiphertext: await oldCipher.encrypt(
        'platform-hmac',
        secretContext.tenantWebhookSecret(tenantId),
      ),
    })
    .where(eq(tenants.id, tenantId));
  const [admin] = await ctx.db
    .insert(adminUsers)
    .values({
      tenantId,
      email: `${issuer}@platform.test`,
      passwordHash: await hashPassword('entegrasyon-parolasi'),
    })
    .returning({ id: adminUsers.id });
  adminId = admin!.id;
  await ctx.db
    .update(adminUsers)
    .set({
      mfaSecretCiphertext: await oldCipher.encrypt('JBSWY3DPEHPK3PXP', secretContext.adminMfaSecret(adminId)),
      mfaEnabledAt: new Date(),
    })
    .where(eq(adminUsers.id, adminId));
});

afterAll(async () => {
  await deleteTenants(ctx.db, [tenantId]);
  await ctx.close();
});

describe('encrypted secrets in PostgreSQL (K-015)', () => {
  it('stores no plaintext and the webhook store hands out only the ciphertext', async () => {
    const found = await new DrizzlePlatformEventStore(ctx.db).findTenant(issuer);
    expect(found?.tenantId).toBe(tenantId);
    expect(found?.secretCiphertext).toMatch(/^lig1\.k1\./);
    expect(found?.secretCiphertext).not.toContain('platform-hmac');
  });

  it('re-encrypts every old-key value with the active key, once', async () => {
    // Yalnızca bu testin tenant'ı: geliştirme veritabanında başka anahtarla yazılmış gerçek kayıtlar da olabilir.
    const first = await rotateStoredSecrets(ctx.db, newCipher, { tenantId });
    expect(first).toEqual({ tenantWebhookSecrets: 1, adminMfaSecrets: 1, unreadable: [] });

    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
    const [admin] = await ctx.db.select().from(adminUsers).where(eq(adminUsers.id, adminId));
    expect(tenant?.webhookSecretCiphertext).toMatch(/^lig1\.k2\./);
    expect(admin?.mfaSecretCiphertext).toMatch(/^lig1\.k2\./);

    // Eski anahtar artık gerekmiyor: yalnızca k2 ile çözülür.
    const onlyNew = new LocalSecretCipher(parseKeyring(k2));
    expect(
      await onlyNew.decrypt(tenant!.webhookSecretCiphertext!, secretContext.tenantWebhookSecret(tenantId)),
    ).toBe('platform-hmac');
    expect(await onlyNew.decrypt(admin!.mfaSecretCiphertext!, secretContext.adminMfaSecret(adminId))).toBe(
      'JBSWY3DPEHPK3PXP',
    );

    const again = await rotateStoredSecrets(ctx.db, newCipher, { tenantId });
    const [tenantAfter] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(tenantAfter?.webhookSecretCiphertext).toBe(tenant?.webhookSecretCiphertext);
    expect(again).toEqual({ tenantWebhookSecrets: 0, adminMfaSecrets: 0, unreadable: [] });
  });

  it('reports records written with a key it does not have and still rotates the rest', async () => {
    const lostKey = new LocalSecretCipher(parseKeyring(`k0:${randomBytes(32).toString('base64')}`));
    const otherTenant = await createTenant(ctx.db, 'secrets-lost-key');
    try {
      const unreadable = await lostKey.encrypt(
        'platform-hmac',
        secretContext.tenantWebhookSecret(otherTenant),
      );
      await ctx.db
        .update(tenants)
        .set({ webhookSecretCiphertext: unreadable })
        .where(eq(tenants.id, otherTenant));

      const scopedElsewhere = await rotateStoredSecrets(ctx.db, newCipher, { tenantId });
      expect(scopedElsewhere.unreadable).toEqual([]);

      const result = await rotateStoredSecrets(ctx.db, newCipher, { tenantId: otherTenant });
      expect(result.unreadable).toEqual([`tenants:${otherTenant}`]);
      const [row] = await ctx.db.select().from(tenants).where(eq(tenants.id, otherTenant));
      expect(row?.webhookSecretCiphertext).toBe(unreadable);
    } finally {
      await deleteTenants(ctx.db, [otherTenant]);
    }
  });
});
