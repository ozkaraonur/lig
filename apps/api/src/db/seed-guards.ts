/** Yalnızca yerel geliştirme için; depoda herkese açık. Herkese açık bir kurulumda kullanılamaz. */
export const DEV_WEBHOOK_SECRET = 'dev-only-webhook-secret-change-me';
export const DEV_ADMIN_PASSWORD = 'gelistirme-yonetici-parolasi';

/** Herkese açık kurulumda sır ve parola için en kısa uzunluk. */
export const MIN_PUBLIC_SECRET_LENGTH = 16;

export interface SeedSecretsCheck {
  /** Web adresi bu bilgisayara ait değil: kurulum internete açık (K-037). */
  publicDeploy: boolean;
  webhookSecret: string;
  adminPassword: string;
}

/**
 * Herkese açık bir kurulumda depodaki bilinen geliştirme sırları ve parolası kullanılamaz: sahte bir webhook
 * (gerçek işlem bildirimi) gönderilebilir ya da yönetici girişi denenebilir. Hata mesajı değerleri yazmaz.
 */
export function assertSeedSecretsSafe(check: SeedSecretsCheck): void {
  if (!check.publicDeploy) return;
  if (check.webhookSecret === DEV_WEBHOOK_SECRET || check.webhookSecret.length < MIN_PUBLIC_SECRET_LENGTH) {
    throw new Error(
      `Herkese açık kurulumda webhook sırrı geliştirme değeri olamaz ve en az ${MIN_PUBLIC_SECRET_LENGTH} karakter olmalı (MOCK_PLATFORM_WEBHOOK_SECRET, MOCK_BROKER_WEBHOOK_SECRET).`,
    );
  }
  if (check.adminPassword === DEV_ADMIN_PASSWORD || check.adminPassword.length < MIN_PUBLIC_SECRET_LENGTH) {
    throw new Error(
      `Herkese açık kurulumda yönetici parolası geliştirme değeri olamaz ve en az ${MIN_PUBLIC_SECRET_LENGTH} karakter olmalı (SEED_ADMIN_PASSWORD).`,
    );
  }
}
