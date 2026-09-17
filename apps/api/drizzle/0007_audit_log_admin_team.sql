-- Faz 2, adım 3 (NFR-07, K-019, K-020).
-- Sondaki tetikleyiciler elle eklendi (drizzle şemasında karşılığı yok): denetim kaydı yalnızca eklenebilir.
CREATE TABLE "admin_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "admin_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_admin_id" uuid,
	"accepted_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "admin_invites_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "admin_invites_email_lowercase" CHECK ("admin_invites"."email" = lower("admin_invites"."email"))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"chain_key" text NOT NULL,
	"tenant_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_admin_id" uuid,
	"actor_email" text,
	"target_type" text,
	"target_id" text,
	"target_label" text,
	"ip" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	CONSTRAINT "audit_events_hash_unique" UNIQUE("hash"),
	CONSTRAINT "audit_events_actor_type" CHECK ("audit_events"."actor_type" in ('admin', 'cli', 'system', 'anonymous'))
);
--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_invited_by_admin_id_admin_users_id_fk" FOREIGN KEY ("invited_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_accepted_admin_id_admin_users_id_fk" FOREIGN KEY ("accepted_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_invites_one_pending_per_email" ON "admin_invites" USING btree ("tenant_id","email") WHERE "admin_invites"."accepted_at" is null and "admin_invites"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "audit_events_chain_key_seq_index" ON "audit_events" USING btree ("chain_key","seq");--> statement-breakpoint
CREATE FUNCTION "audit_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_events_no_update_delete" BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();--> statement-breakpoint
CREATE TRIGGER "audit_events_no_truncate" BEFORE TRUNCATE ON "audit_events" FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_append_only"();
