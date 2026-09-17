import { randomBytes, randomUUID } from 'node:crypto';
import { type AdminRole } from '@lig/shared';
import { type AdminAccount, type AdminRepository, type TokenStore } from './ports';
import { hashPassword } from './password-hasher';

export class InMemoryAdminRepository implements AdminRepository {
  readonly accounts = new Map<string, AdminAccount>();
  readonly tenants = new Map<string, string>();
  readonly logins: Array<{ adminId: string; at: Date }> = [];

  async add(options: { tenantId: string; email: string; password: string; role?: AdminRole }) {
    this.tenants.set(options.tenantId, this.tenants.get(options.tenantId) ?? 'Test Platformu');
    const account: AdminAccount = {
      id: randomUUID(),
      tenantId: options.tenantId,
      email: options.email,
      passwordHash: await hashPassword(options.password),
      role: options.role ?? 'owner',
      mfaSecretCiphertext: null,
      mfaLastUsedStep: null,
    };
    this.accounts.set(account.id, account);
    return account;
  }

  async findByEmail(email: string) {
    return [...this.accounts.values()].find((a) => a.email === email) ?? null;
  }
  async findById(adminId: string) {
    const account = this.accounts.get(adminId);
    return account ? { ...account } : null;
  }
  async tenantName(tenantId: string) {
    return this.tenants.get(tenantId) ?? null;
  }
  async updatePasswordHash(adminId: string, passwordHash: string) {
    const account = this.accounts.get(adminId);
    if (account) account.passwordHash = passwordHash;
  }
  async enableMfa(adminId: string, secretCiphertext: string, usedStep: number) {
    const account = this.accounts.get(adminId);
    if (!account || account.mfaSecretCiphertext !== null) return false;
    account.mfaSecretCiphertext = secretCiphertext;
    account.mfaLastUsedStep = usedStep;
    return true;
  }
  async consumeMfaStep(adminId: string, step: number) {
    const account = this.accounts.get(adminId);
    if (!account || (account.mfaLastUsedStep !== null && account.mfaLastUsedStep >= step)) return false;
    account.mfaLastUsedStep = step;
    return true;
  }
  async recordLogin(adminId: string, at: Date) {
    this.logins.push({ adminId, at });
  }
}

export class InMemoryTokenStore<T> implements TokenStore<T> {
  readonly entries = new Map<string, { data: T; ttlSeconds: number }>();
  async create(data: T, ttlSeconds: number) {
    const token = randomBytes(32).toString('base64url');
    this.entries.set(token, { data, ttlSeconds });
    return token;
  }
  async get(token: string) {
    return this.entries.get(token)?.data ?? null;
  }
  async replace(token: string, data: T) {
    const entry = this.entries.get(token);
    if (!entry) return false;
    entry.data = data;
    return true;
  }
  async touch(token: string, ttlSeconds: number) {
    const entry = this.entries.get(token);
    if (entry) entry.ttlSeconds = ttlSeconds;
  }
  async destroy(token: string) {
    this.entries.delete(token);
  }
}
