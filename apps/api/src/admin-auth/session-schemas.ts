import { z } from 'zod';
import { type AdminPreAuthData, type AdminSessionData } from './ports';

export const adminSessionData: z.ZodType<AdminSessionData> = z.object({
  adminId: z.uuid(),
  tenantId: z.uuid(),
  sessionVersion: z.number().int().min(0),
  createdAtMs: z.number().int(),
});

export const adminPreAuthData: z.ZodType<AdminPreAuthData> = z.object({
  adminId: z.uuid(),
  tenantId: z.uuid(),
  mfaEnrolled: z.boolean(),
  pendingSecretCiphertext: z.string().nullable(),
  createdAtMs: z.number().int(),
});
