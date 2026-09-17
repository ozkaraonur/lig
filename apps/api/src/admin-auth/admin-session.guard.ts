import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_SESSION_COOKIE_NAME, type AdminRole } from '@lig/shared';
import type { FastifyRequest } from 'fastify';
import { AppError, unauthenticated } from '../common/app-error';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { ADMIN_SESSION_ABSOLUTE_SECONDS, ADMIN_SESSION_IDLE_SECONDS } from './admin-auth.service';
import {
  ADMIN_REPOSITORY,
  ADMIN_SESSION_STORE,
  type AdminAccount,
  type AdminRepository,
  type AdminSessionData,
  type TokenStore,
} from './ports';

export interface AuthenticatedAdmin {
  account: AdminAccount;
  sessionToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    ligAdmin?: AuthenticatedAdmin;
  }
}

const ROLES_METADATA = 'lig:admin-roles';

/** Ucu yalnızca verilen rollere açar. Dekoratör yoksa oturumu olan her yönetici girer. */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ROLES_METADATA, roles);

/**
 * Yönetici oturumunu doğrular (T6). Oyuncu çerezi burada hiçbir işe yaramaz; yönetici çerezi de oyuncu
 * uçlarında (SessionGuard) geçmez. Rol ve MFA durumu her istekte veritabanından okunur: rolü düşürülen ya
 * da silinen yönetici, oturumu Redis'te dursa bile bir sonraki istekte yetkisini kaybeder.
 */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ADMIN_SESSION_STORE) private readonly sessions: TokenStore<AdminSessionData>,
    @Inject(ADMIN_REPOSITORY) private readonly admins: AdminRepository,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies?.[ADMIN_SESSION_COOKIE_NAME];
    if (!token) throw unauthenticated();

    const session = await this.sessions.get(token);
    if (!session) throw unauthenticated();

    const ageSeconds = Math.floor((this.clock() - session.createdAtMs) / 1000);
    const remaining = ADMIN_SESSION_ABSOLUTE_SECONDS - ageSeconds;
    if (remaining <= 0) {
      await this.sessions.destroy(token);
      throw unauthenticated();
    }

    const account = await this.admins.findById(session.adminId);
    if (!account || account.tenantId !== session.tenantId || account.mfaSecretCiphertext === null) {
      await this.sessions.destroy(token);
      throw unauthenticated();
    }

    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && !roles.includes(account.role)) {
      throw new AppError('FORBIDDEN', 403, 'Bu işlem için yetkin yok.');
    }

    await this.sessions.touch(token, Math.min(ADMIN_SESSION_IDLE_SECONDS, remaining));
    request.ligAdmin = { account, sessionToken: token };
    return true;
  }
}

export const CurrentAdmin = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthenticatedAdmin => {
    const admin = context.switchToHttp().getRequest<FastifyRequest>().ligAdmin;
    if (!admin) throw unauthenticated();
    return admin;
  },
);
