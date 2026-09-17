import { Inject, Injectable } from '@nestjs/common';
import { type AdminRole } from '@lig/shared';
import { and, asc, count, eq, gt, isNull, sql } from 'drizzle-orm';
import { type AuditEntry, recordAudit, type Tx } from '../audit/audit-log';
import { DB, type Database } from '../db/db.module';
import { adminInvites, adminUsers, tenants } from '../db/schema';
import {
  type AcceptInviteResult,
  type CreateInviteResult,
  type InviteRecord,
  type MemberChangeResult,
  type NewInvite,
  type TeamMember,
  type TeamRepository,
} from './ports';

const memberColumns = {
  id: adminUsers.id,
  email: adminUsers.email,
  role: adminUsers.role,
  mfaEnabledAt: adminUsers.mfaEnabledAt,
  lastLoginAt: adminUsers.lastLoginAt,
  createdAt: adminUsers.createdAt,
};

const inviteColumns = {
  id: adminInvites.id,
  tenantId: adminInvites.tenantId,
  email: adminInvites.email,
  role: adminInvites.role,
  createdAt: adminInvites.createdAt,
  expiresAt: adminInvites.expiresAt,
};

type MemberRow = {
  id: string;
  email: string;
  role: AdminRole;
  mfaEnabledAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

const toMember = (row: MemberRow): TeamMember => ({
  id: row.id,
  email: row.email,
  role: row.role,
  mfaEnabled: row.mfaEnabledAt !== null,
  lastLoginAt: row.lastLoginAt,
  createdAt: row.createdAt,
});

const pending = () => and(isNull(adminInvites.acceptedAt), isNull(adminInvites.revokedAt));

@Injectable()
export class DrizzleTeamRepository implements TeamRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listMembers(tenantId: string): Promise<TeamMember[]> {
    const rows = await this.db
      .select(memberColumns)
      .from(adminUsers)
      .where(eq(adminUsers.tenantId, tenantId))
      .orderBy(asc(adminUsers.createdAt), asc(adminUsers.email));
    return rows.map(toMember);
  }

  listPendingInvites(tenantId: string): Promise<InviteRecord[]> {
    return this.db
      .select(inviteColumns)
      .from(adminInvites)
      .where(and(eq(adminInvites.tenantId, tenantId), pending()))
      .orderBy(asc(adminInvites.createdAt));
  }

  createInvite(invite: NewInvite, audit: (created: InviteRecord) => AuditEntry): Promise<CreateInviteResult> {
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .where(and(eq(adminUsers.tenantId, invite.tenantId), eq(adminUsers.email, invite.email)))
        .limit(1);
      if (member) return { kind: 'already_member' as const };

      // Aynı e-postaya bekleyen eski davet varsa geçersiz olur; eski link artık çalışmaz.
      await tx
        .update(adminInvites)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(adminInvites.tenantId, invite.tenantId), eq(adminInvites.email, invite.email), pending()),
        );
      const [created] = await tx.insert(adminInvites).values(invite).returning(inviteColumns);
      if (!created) throw new Error('Invite insert returned no row');
      await recordAudit(tx, audit(created));
      return { kind: 'created' as const, invite: created };
    });
  }

  revokeInvite(
    tenantId: string,
    inviteId: string,
    now: Date,
    audit: (invite: InviteRecord) => AuditEntry,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(adminInvites)
        .set({ revokedAt: now })
        .where(and(eq(adminInvites.id, inviteId), eq(adminInvites.tenantId, tenantId), pending()))
        .returning(inviteColumns);
      if (!revoked) return false;
      await recordAudit(tx, audit(revoked));
      return true;
    });
  }

  async findPendingInviteByTokenHash(tokenHash: string, now: Date) {
    const [row] = await this.db
      .select({ ...inviteColumns, tenantName: tenants.name })
      .from(adminInvites)
      .innerJoin(tenants, eq(tenants.id, adminInvites.tenantId))
      .where(and(eq(adminInvites.tokenHash, tokenHash), pending(), gt(adminInvites.expiresAt, now)))
      .limit(1);
    return row ?? null;
  }

  acceptInvite(
    tokenHash: string,
    passwordHash: string,
    now: Date,
    audit: (accepted: { adminId: string; invite: InviteRecord }) => AuditEntry,
  ): Promise<AcceptInviteResult> {
    return this.db.transaction(async (tx) => {
      // Satır kilidi: aynı davet iki sekmeden aynı anda kabul edilemez.
      const [invite] = await tx
        .select(inviteColumns)
        .from(adminInvites)
        .where(and(eq(adminInvites.tokenHash, tokenHash), pending(), gt(adminInvites.expiresAt, now)))
        .for('update');
      if (!invite) return { kind: 'invalid' as const };

      const [created] = await tx
        .insert(adminUsers)
        .values({ tenantId: invite.tenantId, email: invite.email, role: invite.role, passwordHash })
        .onConflictDoNothing({ target: adminUsers.email })
        .returning({ id: adminUsers.id });
      if (!created) return { kind: 'email_taken' as const };

      await tx
        .update(adminInvites)
        .set({ acceptedAt: now, acceptedAdminId: created.id })
        .where(eq(adminInvites.id, invite.id));
      await recordAudit(tx, audit({ adminId: created.id, invite }));
      return {
        kind: 'accepted' as const,
        adminId: created.id,
        email: invite.email,
        tenantId: invite.tenantId,
      };
    });
  }

  changeRole(
    tenantId: string,
    actorId: string,
    adminId: string,
    role: AdminRole,
    audit: (member: TeamMember) => AuditEntry,
  ): Promise<MemberChangeResult> {
    return this.db.transaction(async (tx) => {
      const member = await this.lockMember(tx, tenantId, actorId, adminId);
      if (member === 'forbidden') return 'forbidden';
      if (!member) return 'not_found';
      if (member.role === role) return 'unchanged';
      if (member.role === 'owner' && !(await this.hasAnotherOwner(tx, tenantId, adminId)))
        return 'last_owner';
      await tx.update(adminUsers).set({ role }).where(eq(adminUsers.id, adminId));
      await recordAudit(tx, audit(member));
      return 'ok';
    });
  }

  resetMfa(
    tenantId: string,
    actorId: string,
    adminId: string,
    audit: (member: TeamMember) => AuditEntry,
  ): Promise<MemberChangeResult> {
    return this.db.transaction(async (tx) => {
      const member = await this.lockMember(tx, tenantId, actorId, adminId);
      if (member === 'forbidden') return 'forbidden';
      if (!member) return 'not_found';
      await tx
        .update(adminUsers)
        .set({
          mfaSecretCiphertext: null,
          mfaEnabledAt: null,
          mfaLastUsedStep: null,
          sessionVersion: sql`${adminUsers.sessionVersion} + 1`,
        })
        .where(eq(adminUsers.id, adminId));
      await recordAudit(tx, audit(member));
      return 'ok';
    });
  }

  removeMember(
    tenantId: string,
    actorId: string,
    adminId: string,
    audit: (member: TeamMember) => AuditEntry,
  ): Promise<MemberChangeResult> {
    return this.db.transaction(async (tx) => {
      const member = await this.lockMember(tx, tenantId, actorId, adminId);
      if (member === 'forbidden') return 'forbidden';
      if (!member) return 'not_found';
      if (member.role === 'owner' && !(await this.hasAnotherOwner(tx, tenantId, adminId)))
        return 'last_owner';
      await tx.delete(adminUsers).where(eq(adminUsers.id, adminId));
      await recordAudit(tx, audit(member));
      return 'ok';
    });
  }

  changePassword(adminId: string, passwordHash: string, audit: AuditEntry): Promise<number> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(adminUsers)
        .set({ passwordHash, sessionVersion: sql`${adminUsers.sessionVersion} + 1` })
        .where(eq(adminUsers.id, adminId))
        .returning({ sessionVersion: adminUsers.sessionVersion });
      if (!row) throw new Error('Admin not found');
      await recordAudit(tx, audit);
      return row.sessionVersion;
    });
  }

  bumpSessionVersion(adminId: string, audit: AuditEntry): Promise<number> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(adminUsers)
        .set({ sessionVersion: sql`${adminUsers.sessionVersion} + 1` })
        .where(eq(adminUsers.id, adminId))
        .returning({ sessionVersion: adminUsers.sessionVersion });
      if (!row) throw new Error('Admin not found');
      await recordAudit(tx, audit);
      return row.sessionVersion;
    });
  }

  /**
   * Önce tenant satırı kilitlenir, sonra yönetici. Sahip sayısını değiştiren bütün işlemler aynı sırayla
   * kilit aldığı için birbirini sırayla bekler ve kilitlenme (deadlock) olmaz.
   *
   * Kilitten sonra işlemi yapanın hâlâ sahip olduğu tekrar okunur: iki sahip aynı anda birbirini düşürürse,
   * ikinci istek yetki kontrolünü eski rolle geçmiş olsa bile burada durur.
   */
  private async lockMember(
    tx: Tx,
    tenantId: string,
    actorId: string,
    adminId: string,
  ): Promise<TeamMember | 'forbidden' | null> {
    await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).for('update');
    const [actor] = await tx
      .select({ role: adminUsers.role })
      .from(adminUsers)
      .where(and(eq(adminUsers.id, actorId), eq(adminUsers.tenantId, tenantId)));
    if (actor?.role !== 'owner') return 'forbidden';
    const [row] = await tx
      .select(memberColumns)
      .from(adminUsers)
      .where(and(eq(adminUsers.id, adminId), eq(adminUsers.tenantId, tenantId)))
      .for('update');
    return row ? toMember(row) : null;
  }

  private async hasAnotherOwner(tx: Tx, tenantId: string, exceptAdminId: string): Promise<boolean> {
    const [row] = await tx
      .select({ n: count() })
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.tenantId, tenantId),
          eq(adminUsers.role, 'owner'),
          sql`${adminUsers.id} <> ${exceptAdminId}`,
        ),
      );
    return (row?.n ?? 0) > 0;
  }
}
