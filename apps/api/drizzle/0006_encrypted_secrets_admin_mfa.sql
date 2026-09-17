-- Faz 2, adım 1 (K-015, K-016).
-- Düz metin webhook anahtarı silinir, yerine şifreli kolon gelir. Yerel geliştirmede anahtar
-- "npm run db:seed" ile şifreli olarak yeniden yazılır; üretimde bu kolon henüz kullanılmıyordu.
-- Yönetici e-postası küçük harfe çevrilir ve bütün sistemde tekil olur.
UPDATE "admin_users" SET "email" = lower("email");--> statement-breakpoint
ALTER TABLE "admin_users" DROP CONSTRAINT "admin_users_tenantId_email_unique";--> statement-breakpoint
ALTER TABLE "admin_users" DROP COLUMN "mfa_secret";--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "webhook_secret";--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_email_unique" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_email_lowercase" CHECK ("admin_users"."email" = lower("admin_users"."email"));--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "mfa_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "mfa_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "mfa_last_used_step" bigint;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "webhook_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_mfa_consistent" CHECK (("admin_users"."mfa_secret_ciphertext" is null) = ("admin_users"."mfa_enabled_at" is null));
