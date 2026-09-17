import { type AdminRole } from '@lig/shared';
import { type AuditEntry } from '../audit/audit-log';

export interface TeamMember {
  id: string;
  email: string;
  role: AdminRole;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface InviteRecord {
  id: string;
  tenantId: string;
  email: string;
  role: AdminRole;
  createdAt: Date;
  expiresAt: Date;
}

export interface NewInvite {
  tenantId: string;
  email: string;
  role: AdminRole;
  tokenHash: string;
  invitedByAdminId: string;
  expiresAt: Date;
}

export type CreateInviteResult = { kind: 'created'; invite: InviteRecord } | { kind: 'already_member' };

export type AcceptInviteResult =
  | { kind: 'accepted'; adminId: string; email: string; tenantId: string }
  | { kind: 'invalid' }
  /** E-posta başka bir platformda yönetici olarak kayıtlı (e-posta bütün sistemde tekil, K-016). */
  | { kind: 'email_taken' };

/** `forbidden`: işlemi yapan kişi transaction içinde tekrar okunduğunda artık sahip değil. */
export type MemberChangeResult = 'ok' | 'not_found' | 'last_owner' | 'unchanged' | 'forbidden';

/**
 * Ekip işlemleri. Her yazma işlemi denetim kaydıyla aynı transaction'da yapılır (NFR-07): değişiklik ya
 * kaydıyla birlikte yazılır ya da hiç yazılmaz. Sahip sayısını etkileyen işlemler tenant satırını kilitler;
 * iki sahip aynı anda birbirini düşürmeye çalışsa da en az bir sahip kalır.
 */
export interface TeamRepository {
  listMembers(tenantId: string): Promise<TeamMember[]>;
  listPendingInvites(tenantId: string): Promise<InviteRecord[]>;
  createInvite(invite: NewInvite, audit: (created: InviteRecord) => AuditEntry): Promise<CreateInviteResult>;
  revokeInvite(
    tenantId: string,
    inviteId: string,
    now: Date,
    audit: (invite: InviteRecord) => AuditEntry,
  ): Promise<boolean>;
  findPendingInviteByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<(InviteRecord & { tenantName: string }) | null>;
  acceptInvite(
    tokenHash: string,
    passwordHash: string,
    now: Date,
    audit: (accepted: { adminId: string; invite: InviteRecord }) => AuditEntry,
  ): Promise<AcceptInviteResult>;
  changeRole(
    tenantId: string,
    actorId: string,
    adminId: string,
    role: AdminRole,
    audit: (member: TeamMember) => AuditEntry,
  ): Promise<MemberChangeResult>;
  /** MFA'yı siler ve oturum sürümünü artırır: yönetici her yerden çıkar, sonraki girişte MFA'yı yeniden kurar. */
  resetMfa(
    tenantId: string,
    actorId: string,
    adminId: string,
    audit: (member: TeamMember) => AuditEntry,
  ): Promise<MemberChangeResult>;
  removeMember(
    tenantId: string,
    actorId: string,
    adminId: string,
    audit: (member: TeamMember) => AuditEntry,
  ): Promise<MemberChangeResult>;
  /** Parolayı değiştirir ve oturum sürümünü artırır. Yeni sürümü döner. */
  changePassword(adminId: string, passwordHash: string, audit: AuditEntry): Promise<number>;
  /** Oturum sürümünü artırır. Yeni sürümü döner. */
  bumpSessionVersion(adminId: string, audit: AuditEntry): Promise<number>;
}

export const TEAM_REPOSITORY = Symbol('TEAM_REPOSITORY');
