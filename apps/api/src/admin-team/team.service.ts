import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminInviteCreatedResponse,
  type AdminInviteLookupResponse,
  type AdminInviteRequest,
  type AdminInviteView,
  type AdminRole,
  type AdminTeamResponse,
} from '@lig/shared';
import { adminActor, adminTarget } from '../admin-auth/admin-auth.service';
import { hashPassword } from '../admin-auth/password-hasher';
import { type AdminAccount } from '../admin-auth/ports';
import { RATE_LIMITER, type RateLimiter } from '../auth/ports';
import { AppError } from '../common/app-error';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { ENV, type Env } from '../config/env';
import { type InviteRecord, type MemberChangeResult, TEAM_REPOSITORY, type TeamRepository } from './ports';

/** Davet linkinin ömrü. */
export const INVITE_TTL_HOURS = 72;

export const TEAM_RATE_LIMITS = {
  invitesPerAdmin: { limit: 20, windowSeconds: 60 * 60 },
  inviteLookupPerIp: { limit: 30, windowSeconds: 15 * 60 },
  inviteAcceptPerIp: { limit: 10, windowSeconds: 15 * 60 },
};

const notFound = () => new AppError('NOT_FOUND', 404, 'Yönetici bulunamadı.');
const inviteInvalid = () =>
  new AppError(
    'INVITE_INVALID',
    404,
    'Davet bağlantısı geçersiz, süresi dolmuş ya da daha önce kullanılmış.',
  );
const selfChange = () => new AppError('FORBIDDEN', 403, 'Bu işlemi kendi hesabında yapamazsın.');
const lastOwner = () =>
  new AppError('LAST_OWNER', 409, 'Platformda en az bir sahip kalmalı. Önce başka birini sahip yap.');

export const hashInviteToken = (token: string) => createHash('sha256').update(token).digest('hex');

function toInviteView(invite: InviteRecord, now: number): AdminInviteView {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
    expired: invite.expiresAt.getTime() <= now,
  };
}

/**
 * Ekip yönetimi (yalnızca sahip rolü; rol kontrolü controller'da). Bütün hedefler oturumdaki tenant ile
 * sınırlı: başka platformun yöneticisi "yok" ile aynı 404'ü alır.
 */
@Injectable()
export class TeamService {
  constructor(
    @Inject(TEAM_REPOSITORY) private readonly team: TeamRepository,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
    @Inject(ENV) private readonly env: Pick<Env, 'WEB_ORIGIN'>,
  ) {}

  async list(owner: AdminAccount): Promise<AdminTeamResponse> {
    const [members, invites] = await Promise.all([
      this.team.listMembers(owner.tenantId),
      this.team.listPendingInvites(owner.tenantId),
    ]);
    const now = this.clock();
    return {
      admins: members.map((m) => ({
        id: m.id,
        email: m.email,
        role: m.role,
        mfaEnabled: m.mfaEnabled,
        lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      invites: invites.map((i) => toInviteView(i, now)),
    };
  }

  async invite(
    owner: AdminAccount,
    input: AdminInviteRequest,
    ip: string,
  ): Promise<AdminInviteCreatedResponse> {
    await this.limit(`rl:admin-invite:${owner.id}`, TEAM_RATE_LIMITS.invitesPerAdmin);
    const token = randomBytes(32).toString('base64url');
    const now = this.clock();
    const result = await this.team.createInvite(
      {
        tenantId: owner.tenantId,
        email: input.email,
        role: input.role,
        tokenHash: hashInviteToken(token),
        invitedByAdminId: owner.id,
        expiresAt: new Date(now + INVITE_TTL_HOURS * 3_600_000),
      },
      (created) => ({
        tenantId: owner.tenantId,
        action: 'admin.invited',
        actor: adminActor(owner),
        target: { type: 'invite', id: created.id, label: created.email },
        ip,
        metadata: { role: created.role },
        occurredAt: new Date(now),
      }),
    );
    if (result.kind === 'already_member') {
      throw new AppError('CONFLICT', 409, 'Bu e-posta zaten ekipte.');
    }
    // Token yalnızca adresin # sonrasında: tarayıcı bu kısmı sunucuya ve loglara göndermez.
    const inviteUrl = `${this.env.WEB_ORIGIN}/admin/invite#token=${token}`;
    return { invite: toInviteView(result.invite, now), inviteUrl };
  }

  async revokeInvite(owner: AdminAccount, inviteId: string, ip: string): Promise<void> {
    const revoked = await this.team.revokeInvite(
      owner.tenantId,
      inviteId,
      new Date(this.clock()),
      (invite) => ({
        tenantId: owner.tenantId,
        action: 'admin.invite.revoked',
        actor: adminActor(owner),
        target: { type: 'invite', id: invite.id, label: invite.email },
        ip,
        occurredAt: new Date(this.clock()),
      }),
    );
    if (!revoked) throw new AppError('NOT_FOUND', 404, 'Davet bulunamadı.');
  }

  async changeRole(owner: AdminAccount, adminId: string, role: AdminRole, ip: string): Promise<void> {
    if (adminId === owner.id) throw selfChange();
    const result = await this.team.changeRole(owner.tenantId, owner.id, adminId, role, (member) => ({
      tenantId: owner.tenantId,
      action: 'admin.role.changed',
      actor: adminActor(owner),
      target: adminTarget(member),
      ip,
      metadata: { from: member.role, to: role },
      occurredAt: new Date(this.clock()),
    }));
    this.assertChanged(result, true);
  }

  async resetMfa(owner: AdminAccount, adminId: string, ip: string): Promise<void> {
    // Kendi MFA'sını sıfırlamak isteyen sahip önce başka bir sahibe başvurur ya da komut satırını kullanır:
    // oturumu ele geçirilmiş biri MFA'yı kendi telefonuna taşıyamasın.
    if (adminId === owner.id) throw selfChange();
    const result = await this.team.resetMfa(owner.tenantId, owner.id, adminId, (member) => ({
      tenantId: owner.tenantId,
      action: 'admin.mfa.reset',
      actor: adminActor(owner),
      target: adminTarget(member),
      ip,
      occurredAt: new Date(this.clock()),
    }));
    this.assertChanged(result, false);
  }

  async remove(owner: AdminAccount, adminId: string, ip: string): Promise<void> {
    if (adminId === owner.id) throw selfChange();
    const result = await this.team.removeMember(owner.tenantId, owner.id, adminId, (member) => ({
      tenantId: owner.tenantId,
      action: 'admin.removed',
      actor: adminActor(owner),
      target: adminTarget(member),
      ip,
      metadata: { role: member.role },
      occurredAt: new Date(this.clock()),
    }));
    this.assertChanged(result, false);
  }

  /** Daveti açan kişi (oturumu yok) bilgileri görür. Geçersiz her durum aynı 404. */
  async lookupInvite(token: string, ip: string): Promise<AdminInviteLookupResponse> {
    await this.limit(`rl:admin-invite-lookup:${ip}`, TEAM_RATE_LIMITS.inviteLookupPerIp);
    const invite = await this.team.findPendingInviteByTokenHash(
      hashInviteToken(token),
      new Date(this.clock()),
    );
    if (!invite) throw inviteInvalid();
    return {
      email: invite.email,
      role: invite.role,
      tenantName: invite.tenantName,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  async acceptInvite(token: string, password: string, ip: string): Promise<{ email: string }> {
    await this.limit(`rl:admin-invite-accept:${ip}`, TEAM_RATE_LIMITS.inviteAcceptPerIp);
    const tokenHash = hashInviteToken(token);
    // Pahalı parola hash'i yalnızca geçerli davet için hesaplanır.
    if (!(await this.team.findPendingInviteByTokenHash(tokenHash, new Date(this.clock()))))
      throw inviteInvalid();
    const passwordHash = await hashPassword(password);
    const now = new Date(this.clock());
    const result = await this.team.acceptInvite(tokenHash, passwordHash, now, ({ adminId, invite }) => ({
      tenantId: invite.tenantId,
      action: 'admin.invite.accepted',
      actor: { type: 'admin', adminId, email: invite.email },
      target: { type: 'admin', id: adminId, label: invite.email },
      ip,
      metadata: { role: invite.role, inviteId: invite.id },
      occurredAt: now,
    }));
    if (result.kind === 'invalid') throw inviteInvalid();
    if (result.kind === 'email_taken') {
      throw new AppError(
        'CONFLICT',
        409,
        'Bu e-posta başka bir platformda yönetici olarak kayıtlı. Davet edenden farklı bir e-postaya davet iste.',
      );
    }
    return { email: result.email };
  }

  private assertChanged(result: MemberChangeResult, unchangedIsOk: boolean): void {
    if (result === 'forbidden') throw new AppError('FORBIDDEN', 403, 'Bu işlem için yetkin yok.');
    if (result === 'not_found') throw notFound();
    if (result === 'last_owner') throw lastOwner();
    if (result === 'unchanged' && !unchangedIsOk) throw notFound();
  }

  private async limit(key: string, policy: { limit: number; windowSeconds: number }): Promise<void> {
    const result = await this.limiter.hit(key, policy.limit, policy.windowSeconds);
    if (!result.allowed) {
      throw new AppError('RATE_LIMITED', 429, 'Çok fazla deneme. Biraz sonra tekrar dene.', {
        'retry-after': String(result.retryAfterSeconds),
      });
    }
  }
}
