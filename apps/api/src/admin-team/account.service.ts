import { Inject, Injectable } from '@nestjs/common';
import { AdminAuthService, adminActor, adminTarget } from '../admin-auth/admin-auth.service';
import { hashPassword, verifyPassword } from '../admin-auth/password-hasher';
import {
  ADMIN_SESSION_STORE,
  type AdminAccount,
  type AdminSessionData,
  type TokenStore,
} from '../admin-auth/ports';
import { RATE_LIMITER, type RateLimiter } from '../auth/ports';
import { AppError } from '../common/app-error';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { TEAM_REPOSITORY, type TeamRepository } from './ports';

export const PASSWORD_CHANGE_LIMIT = { limit: 5, windowSeconds: 15 * 60 };

/** Yöneticinin kendi hesabı: parola değiştirme ve diğer oturumları kapatma. Her rol kullanabilir. */
@Injectable()
export class AccountService {
  constructor(
    @Inject(TEAM_REPOSITORY) private readonly team: TeamRepository,
    @Inject(ADMIN_SESSION_STORE) private readonly sessions: TokenStore<AdminSessionData>,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
    private readonly auth: AdminAuthService,
  ) {}

  /**
   * Mevcut parola doğrulanır. Başarılıysa bütün oturumlar (bu dahil) düşer ve bu tarayıcıya yeni oturum
   * verilir: parolayı bilen başka biri açık oturumunu kullanmaya devam edemez.
   */
  async changePassword(
    admin: AdminAccount,
    currentSessionToken: string,
    currentPassword: string,
    newPassword: string,
    ip: string,
  ): Promise<string> {
    const rate = await this.limiter.hit(
      `rl:admin-password-change:${admin.id}`,
      PASSWORD_CHANGE_LIMIT.limit,
      PASSWORD_CHANGE_LIMIT.windowSeconds,
    );
    if (!rate.allowed) {
      throw new AppError('RATE_LIMITED', 429, 'Çok fazla deneme. Biraz sonra tekrar dene.', {
        'retry-after': String(rate.retryAfterSeconds),
      });
    }
    if (!(await verifyPassword(admin.passwordHash, currentPassword)).valid) {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Mevcut parola hatalı.');
    }
    const sessionVersion = await this.team.changePassword(admin.id, await hashPassword(newPassword), {
      tenantId: admin.tenantId,
      action: 'admin.password.changed',
      actor: adminActor(admin),
      target: adminTarget(admin),
      ip,
      occurredAt: new Date(this.clock()),
    });
    return this.reissue(admin, currentSessionToken, sessionVersion);
  }

  async revokeOtherSessions(admin: AdminAccount, currentSessionToken: string, ip: string): Promise<string> {
    const sessionVersion = await this.team.bumpSessionVersion(admin.id, {
      tenantId: admin.tenantId,
      action: 'admin.sessions.revoked',
      actor: adminActor(admin),
      target: adminTarget(admin),
      ip,
      occurredAt: new Date(this.clock()),
    });
    return this.reissue(admin, currentSessionToken, sessionVersion);
  }

  private async reissue(
    admin: AdminAccount,
    currentSessionToken: string,
    sessionVersion: number,
  ): Promise<string> {
    await this.sessions.destroy(currentSessionToken);
    return this.auth.issueSession({ id: admin.id, tenantId: admin.tenantId, sessionVersion });
  }
}
