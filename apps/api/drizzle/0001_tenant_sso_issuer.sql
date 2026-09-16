ALTER TABLE "tenants" ADD COLUMN "sso_issuer" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_ssoIssuer_unique" UNIQUE("sso_issuer");