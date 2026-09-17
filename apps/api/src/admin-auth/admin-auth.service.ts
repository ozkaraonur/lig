import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AdminLoginRequest,
  type AdminLoginResponse,
  type AdminMeResponse,
  type AdminMfaSetupResponse,
} from '@lig/shared';
import { AppError, unauthenticated } from '../common/app-error';
import { CLOCK_MS, type MsClock } from '../common/clock';
import { AUDIT_LOG, type AuditActor, type AuditLog } from '../audit/audit-log';
import { RATE_LIMITER, type RateLimiter } from '../auth/ports';
import { SECRET_CIPHER, type SecretCipher, secretContext } from '../secrets/secret-cipher';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password-hasher';
import {
  ADMIN_PREAUTH_STORE,
  ADMIN_REPOSITORY,
  ADMIN_SESSION_STORE,
  type AdminAccount,
  type AdminPreAuthData,
  type AdminRepository,
  type AdminSessionData,
  type TokenStore,
} from './ports';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

/** Oturum süreleri (T6). Hareketsiz kalınca 30 dk'da, her durumda 8 saatte düşer. */
export const ADMIN_SESSION_IDLE_SECONDS = 30 * 60;
export const ADMIN_SESSION_ABSOLUTE_SECONDS = 8 * 60 * 60;
/** Parola ile MFA adımı arasındaki süre. */
export const ADMIN_PREAUTH_TTL_SECONDS = 10 * 60;

/**
 * Deneme sınırları (T6). Hepsi deneme sayar, yalnızca hatalıları değil.
 * - IP başına: tek adresten çok hesaba parola denemesi (password spraying).
 * - Hesap başına: tek hesaba farklı adreslerden deneme. Bedeli: saldırgan bir yöneticiyi 15 dk girişten
 *   alıkoyabilir; hesap kalıcı kilitlenmez.
 * - MFA, yönetici başına: parolayı bilen biri 15 dk'da en fazla 5 kod dener. Pencere 3 kodu kabul ettiği için
 *   her deneme ~3/1.000.000 şans; günde en fazla 480 deneme, yani günde yaklaşık %0,14.
 * - MFA, giriş adımı başına: 3 denemeden sonra adım silinir, parola yeniden istenir.
 */
export const ADMIN_RATE_LIMITS = {
  loginPerIp: { limit: 20, windowSeconds: 15 * 60 },
  loginPerAccount: { limit: 10, windowSeconds: 15 * 60 },
  mfaPerAdmin: { limit: 5, windowSeconds: 15 * 60 },
  mfaPerPreAuth: { limit: 3, windowSeconds: ADMIN_PREAUTH_TTL_SECONDS },
};

/** Doğrulama uygulamasında hesabın üstünde görünen ad. */
export const TOTP_ISSUER = 'Lig';

const invalidCredentials = () => new AppError('INVALID_CREDENTIALS', 401, 'E-posta ya da parola hatalı.');
const invalidMfaCode = () => new AppError('INVALID_MFA_CODE', 401, 'Kod hatalı ya da süresi geçmiş.');
const preAuthExpired = () => unauthenticated('Giriş adımının süresi doldu. Tekrar giriş yap.');
const rateLimited = (retryAfterSeconds: number) =>
  new AppError('RATE_LIMITED', 429, 'Çok fazla deneme. Biraz sonra tekrar dene.', {
    'retry-after': String(retryAfterSeconds),
  });

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export interface StartedLogin extends AdminLoginResponse {
  preAuthToken: string;
  ttlSeconds: number;
}

export interface CompletedLogin {
  sessionToken: string;
  me: AdminMeResponse;
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    @Inject(ADMIN_REPOSITORY) private readonly admins: AdminRepository,
    @Inject(ADMIN_SESSION_STORE) private readonly sessions: TokenStore<AdminSessionData>,
    @Inject(ADMIN_PREAUTH_STORE) private readonly preAuths: TokenStore<AdminPreAuthData>,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(CLOCK_MS) private readonly clock: MsClock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  /** 1. adım: e-posta ve parola. Hesap yoksa, parola yanlışsa aynı cevap ve benzer süre. */
  async login(input: AdminLoginRequest, clientIp: string): Promise<StartedLogin> {
    await this.limit(`rl:admin-login-ip:${clientIp}`, ADMIN_RATE_LIMITS.loginPerIp);
    await this.limit(`rl:admin-login-account:${digest(input.email)}`, ADMIN_RATE_LIMITS.loginPerAccount);

    const admin = await this.admins.findByEmail(input.email);
    if (!admin) {
      await burnPasswordCheck(input.password);
      throw invalidCredentials();
    }
    const check = await verifyPassword(admin.passwordHash, input.password);
    if (!check.valid) {
      // Kayıtlı hesaba yanlış parola denemesi. Bilinmeyen e-postalar kaydedilmez: kaydı hangi platformun
      // zincirine yazacağımız belli değil ve deneme sınırıyla zaten sınırlı.
      await this.audit.append({
        tenantId: admin.tenantId,
        action: 'admin.login.failed',
        actor: { type: 'anonymous' },
        target: adminTarget(admin),
        ip: clientIp,
        metadata: { reason: 'password' },
        occurredAt: new Date(this.clock()),
      });
      throw invalidCredentials();
    }
    if (check.needsRehash) await this.admins.updatePasswordHash(admin.id, await hashPassword(input.password));

    const mfaEnrolled = admin.mfaSecretCiphertext !== null;
    const preAuthToken = await this.preAuths.create(
      {
        adminId: admin.id,
        tenantId: admin.tenantId,
        mfaEnrolled,
        pendingSecretCiphertext: null,
        createdAtMs: this.clock(),
      },
      ADMIN_PREAUTH_TTL_SECONDS,
    );
    return {
      preAuthToken,
      ttlSeconds: ADMIN_PREAUTH_TTL_SECONDS,
      next: mfaEnrolled ? 'mfa_verify' : 'mfa_setup',
    };
  }

  /**
   * 2a. adım (ilk giriş): TOTP secret'ı üretir. Onaylanana kadar veritabanına değil giriş adımına yazılır;
   * sayfa yenilenirse aynı secret döner, telefona okutulmuş QR geçersiz olmaz.
   */
  async startMfaSetup(preAuthToken: string | undefined): Promise<AdminMfaSetupResponse> {
    const { token, data } = await this.requirePreAuth(preAuthToken);
    const admin = await this.admins.findById(data.adminId);
    if (!admin || admin.tenantId !== data.tenantId) throw preAuthExpired();
    if (data.mfaEnrolled || admin.mfaSecretCiphertext !== null) {
      throw new AppError('FORBIDDEN', 403, 'Bu hesapta MFA zaten kurulu.');
    }

    const context = secretContext.adminMfaSecret(admin.id);
    let secret: string;
    if (data.pendingSecretCiphertext) {
      secret = await this.cipher.decrypt(data.pendingSecretCiphertext, context);
    } else {
      secret = generateTotpSecret();
      const stored = await this.preAuths.replace(token, {
        ...data,
        pendingSecretCiphertext: await this.cipher.encrypt(secret, context),
      });
      if (!stored) throw preAuthExpired();
    }
    return { secret, otpauthUri: otpauthUri({ issuer: TOTP_ISSUER, account: admin.email, secret }) };
  }

  /** 2b. adım: 6 haneli kod. Doğruysa giriş adımı silinir ve yeni, ayrı bir oturum açılır. */
  async verifyMfa(preAuthToken: string | undefined, code: string, clientIp: string): Promise<CompletedLogin> {
    const { token, data } = await this.requirePreAuth(preAuthToken);
    await this.limit(`rl:admin-mfa:${data.adminId}`, ADMIN_RATE_LIMITS.mfaPerAdmin);
    const perAttempt = await this.limiter.hit(
      `rl:admin-mfa-preauth:${digest(token)}`,
      ADMIN_RATE_LIMITS.mfaPerPreAuth.limit,
      ADMIN_RATE_LIMITS.mfaPerPreAuth.windowSeconds,
    );
    if (!perAttempt.allowed) {
      await this.preAuths.destroy(token);
      throw preAuthExpired();
    }

    const admin = await this.admins.findById(data.adminId);
    if (!admin || admin.tenantId !== data.tenantId) throw preAuthExpired();

    const accepted = data.mfaEnrolled
      ? await this.verifyEnrolled(admin, code)
      : await this.confirmEnrollment(admin, data, code);
    if (!accepted) {
      // Parolayı bilen biri yanlış kod girdi: hesabın parolası sızmış olabilir, önemli sinyal.
      await this.audit.append({
        tenantId: admin.tenantId,
        action: 'admin.mfa.failed',
        actor: { type: 'anonymous' },
        target: adminTarget(admin),
        ip: clientIp,
        metadata: { stage: data.mfaEnrolled ? 'verify' : 'setup' },
        occurredAt: new Date(this.clock()),
      });
      throw invalidMfaCode();
    }

    await this.preAuths.destroy(token);
    const now = new Date(this.clock());
    const actor = adminActor(admin);
    if (!data.mfaEnrolled) {
      await this.audit.append({
        tenantId: admin.tenantId,
        action: 'admin.mfa.enrolled',
        actor,
        target: adminTarget(admin),
        ip: clientIp,
        occurredAt: now,
      });
    }
    const sessionToken = await this.issueSession(admin);
    await this.admins.recordLogin(admin.id, now);
    await this.audit.append({
      tenantId: admin.tenantId,
      action: 'admin.login.succeeded',
      actor,
      target: adminTarget(admin),
      ip: clientIp,
      occurredAt: now,
    });
    return { sessionToken, me: await this.me(admin) };
  }

  /** Yöneticinin güncel oturum sürümüyle yeni bir oturum açar. */
  async issueSession(admin: Pick<AdminAccount, 'id' | 'tenantId' | 'sessionVersion'>): Promise<string> {
    return this.sessions.create(
      {
        adminId: admin.id,
        tenantId: admin.tenantId,
        sessionVersion: admin.sessionVersion,
        createdAtMs: this.clock(),
      },
      ADMIN_SESSION_IDLE_SECONDS,
    );
  }

  async me(admin: AdminAccount): Promise<AdminMeResponse> {
    const tenantName = await this.admins.tenantName(admin.tenantId);
    if (tenantName === null) throw unauthenticated();
    return { admin: { id: admin.id, email: admin.email, role: admin.role }, tenant: { name: tenantName } };
  }

  async logout(admin: AdminAccount, sessionToken: string, clientIp: string): Promise<void> {
    await this.sessions.destroy(sessionToken);
    await this.audit.append({
      tenantId: admin.tenantId,
      action: 'admin.logout',
      actor: adminActor(admin),
      target: adminTarget(admin),
      ip: clientIp,
      occurredAt: new Date(this.clock()),
    });
  }

  private async verifyEnrolled(admin: AdminAccount, code: string): Promise<boolean> {
    if (!admin.mfaSecretCiphertext) return false;
    const secret = await this.readSecret(admin.id, admin.mfaSecretCiphertext);
    const step = verifyTotp(secret, code, Math.floor(this.clock() / 1000), admin.mfaLastUsedStep);
    return step !== null && (await this.admins.consumeMfaStep(admin.id, step));
  }

  private async confirmEnrollment(
    admin: AdminAccount,
    data: AdminPreAuthData,
    code: string,
  ): Promise<boolean> {
    if (!data.pendingSecretCiphertext || admin.mfaSecretCiphertext !== null) return false;
    const secret = await this.readSecret(admin.id, data.pendingSecretCiphertext);
    const step = verifyTotp(secret, code, Math.floor(this.clock() / 1000), null);
    if (step === null) return false;
    return this.admins.enableMfa(admin.id, data.pendingSecretCiphertext, step, new Date(this.clock()));
  }

  private async readSecret(adminId: string, ciphertext: string): Promise<string> {
    try {
      return await this.cipher.decrypt(ciphertext, secretContext.adminMfaSecret(adminId));
    } catch (err) {
      this.logger.error(`MFA secret of admin ${adminId} cannot be decrypted; check SECRET_KEYS`);
      throw err;
    }
  }

  private async requirePreAuth(
    token: string | undefined,
  ): Promise<{ token: string; data: AdminPreAuthData }> {
    if (!token) throw preAuthExpired();
    const data = await this.preAuths.get(token);
    if (!data) throw preAuthExpired();
    return { token, data };
  }

  private async limit(key: string, policy: { limit: number; windowSeconds: number }): Promise<void> {
    const result = await this.limiter.hit(key, policy.limit, policy.windowSeconds);
    if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
  }
}

export function adminActor(admin: Pick<AdminAccount, 'id' | 'email'>): AuditActor {
  return { type: 'admin', adminId: admin.id, email: admin.email };
}

export function adminTarget(admin: Pick<AdminAccount, 'id' | 'email'>) {
  return { type: 'admin', id: admin.id, label: admin.email };
}
