import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { SESSION_COOKIE_NAME } from '@lig/shared';
import type { FastifyRequest } from 'fastify';
import { unauthenticated } from '../common/app-error';
import { SESSION_STORE, type SessionData, type SessionStore } from './ports';

export interface AuthenticatedSession extends SessionData {
  token: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    ligSession?: AuthenticatedSession;
  }
}

/** Oturum çerezi olmayan ya da geçersiz olan her isteği 401 ile durdurur. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SESSION_STORE) private readonly sessions: SessionStore) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (!token) throw unauthenticated();

    const data = await this.sessions.get(token);
    if (!data) throw unauthenticated();

    request.ligSession = { ...data, token };
    return true;
  }
}

/** SessionGuard'ın doğruladığı oturumu controller parametresi olarak verir. */
export const CurrentSession = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthenticatedSession => {
    const session = context.switchToHttp().getRequest<FastifyRequest>().ligSession;
    if (!session) throw unauthenticated();
    return session;
  },
);
