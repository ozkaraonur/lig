import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { adminUsers, tenants } from '../db/schema';
import { type AdminAccount, type AdminRepository } from './ports';

const accountColumns = {
  id: adminUsers.id,
  tenantId: adminUsers.tenantId,
  email: adminUsers.email,
  passwordHash: adminUsers.passwordHash,
  role: adminUsers.role,
  mfaSecretCiphertext: adminUsers.mfaSecretCiphertext,
  mfaLastUsedStep: adminUsers.mfaLastUsedStep,
  sessionVersion: adminUsers.sessionVersion,
};

@Injectable()
export class DrizzleAdminRepository implements AdminRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findByEmail(email: string): Promise<AdminAccount | null> {
    const [row] = await this.db
      .select(accountColumns)
      .from(adminUsers)
      .where(eq(adminUsers.email, email))
      .limit(1);
    return row ?? null;
  }

  async findById(adminId: string): Promise<AdminAccount | null> {
    const [row] = await this.db
      .select(accountColumns)
      .from(adminUsers)
      .where(eq(adminUsers.id, adminId))
      .limit(1);
    return row ?? null;
  }

  async tenantName(tenantId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return row?.name ?? null;
  }

  async updatePasswordHash(adminId: string, passwordHash: string): Promise<void> {
    await this.db.update(adminUsers).set({ passwordHash }).where(eq(adminUsers.id, adminId));
  }

  async enableMfa(adminId: string, secretCiphertext: string, usedStep: number, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(adminUsers)
      .set({ mfaSecretCiphertext: secretCiphertext, mfaEnabledAt: at, mfaLastUsedStep: usedStep })
      .where(and(eq(adminUsers.id, adminId), isNull(adminUsers.mfaSecretCiphertext)))
      .returning({ id: adminUsers.id });
    return rows.length === 1;
  }

  async consumeMfaStep(adminId: string, step: number): Promise<boolean> {
    const rows = await this.db
      .update(adminUsers)
      .set({ mfaLastUsedStep: step })
      .where(
        and(
          eq(adminUsers.id, adminId),
          or(isNull(adminUsers.mfaLastUsedStep), lt(adminUsers.mfaLastUsedStep, step)),
        ),
      )
      .returning({ id: adminUsers.id });
    return rows.length === 1;
  }

  async recordLogin(adminId: string, at: Date): Promise<void> {
    await this.db.update(adminUsers).set({ lastLoginAt: at }).where(eq(adminUsers.id, adminId));
  }
}
