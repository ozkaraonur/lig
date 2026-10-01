import { z } from 'zod';

/**
 * Denetim kaydına yazılan işlemler (NFR-07). Değer veritabanında metin olarak durur; yeni işlem eklemek
 * migration gerektirmez, eski kayıtların anlamı değişmez.
 */
export const AUDIT_ACTIONS = [
  'admin.login.succeeded',
  'admin.login.failed',
  'admin.mfa.failed',
  'admin.mfa.enrolled',
  'admin.logout',
  'admin.created',
  'admin.invited',
  'admin.invite.revoked',
  'admin.invite.accepted',
  'admin.role.changed',
  'admin.mfa.reset',
  'admin.removed',
  'admin.password.changed',
  'admin.sessions.revoked',
  'secrets.rotated',
  'league.created',
  'league.updated',
  'league.deleted',
  'compliance.changed',
  'quest.created',
  'quest.updated',
  'quest.deleted',
  'branding.changed',
  'export.created',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Kim yaptı: panelden bir yönetici, komut satırı (sunucuya erişimi olan kişi) ya da sistemin kendisi. */
export const AUDIT_ACTOR_TYPES = ['admin', 'cli', 'system', 'anonymous'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export interface AuditEventView {
  seq: number;
  occurredAt: string;
  action: AuditAction;
  actorType: AuditActorType;
  actorEmail: string | null;
  targetType: string | null;
  targetLabel: string | null;
  ip: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface AuditListResponse {
  events: AuditEventView[];
  /** Sonraki sayfa için `before` değeri. Daha eski kayıt yoksa null. */
  nextBefore: number | null;
}

export interface AuditVerifyResponse {
  ok: boolean;
  checked: number;
  /** Zincirin ilk bozulduğu kayıt. Zincir sağlamsa null. */
  brokenAtSeq: number | null;
  /**
   * Son kaydın özeti. Sondan silinen kayıtlar zincirden anlaşılamaz; bu değer dışarıda (ör. aylık raporda)
   * saklanıp sonra karşılaştırılırsa anlaşılır.
   */
  lastHash: string | null;
}

export const auditListQuery = z.strictObject({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditListQuery = z.infer<typeof auditListQuery>;
