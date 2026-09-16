CREATE TYPE "public"."admin_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."asset_class" AS ENUM('crypto', 'equity');--> statement-breakpoint
CREATE TYPE "public"."league_status" AS ENUM('draft', 'active', 'finished');--> statement-breakpoint
CREATE TYPE "public"."league_type" AS ENUM('weekly', 'season', 'friends');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."platform_event_type" AS ENUM('real_trade', 'account_opened');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" DEFAULT 'viewer' NOT NULL,
	"mfa_secret" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_tenantId_email_unique" UNIQUE("tenant_id","email")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	CONSTRAINT "assets_tenantId_symbol_unique" UNIQUE("tenant_id","symbol")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "league_type" NOT NULL,
	"status" "league_status" DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"starting_cash" numeric(20, 2) NOT NULL,
	"asset_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_ends_after_starts" CHECK ("leagues"."ends_at" > "leagues"."starts_at"),
	CONSTRAINT "leagues_starting_cash_positive" CHECK ("leagues"."starting_cash" > 0)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"cash" numeric(20, 2) NOT NULL,
	"final_rank" integer,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_leagueId_playerId_unique" UNIQUE("league_id","player_id"),
	CONSTRAINT "memberships_cash_non_negative" CHECK ("memberships"."cash" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_event_id" text NOT NULL,
	"player_id" uuid,
	"type" "platform_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_events_tenantId_externalEventId_unique" UNIQUE("tenant_id","external_event_id")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_tenantId_externalId_unique" UNIQUE("tenant_id","external_id"),
	CONSTRAINT "players_xp_non_negative" CHECK ("players"."xp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"membership_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"quantity" numeric(30, 10) NOT NULL,
	"avg_cost" numeric(30, 10) NOT NULL,
	CONSTRAINT "positions_membership_id_asset_id_pk" PRIMARY KEY("membership_id","asset_id"),
	CONSTRAINT "positions_quantity_non_negative" CHECK ("positions"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quest_progress" (
	"player_id" uuid NOT NULL,
	"quest_id" uuid NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "quest_progress_player_id_quest_id_pk" PRIMARY KEY("player_id","quest_id")
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template" text NOT NULL,
	"target_count" integer NOT NULL,
	"xp_reward" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sso_public_key" text,
	"data_residency" text DEFAULT 'any' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "virtual_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"side" "order_side" NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"price" numeric(30, 10) NOT NULL,
	"quantity" numeric(30, 10) NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "virtual_orders_membershipId_idempotencyKey_unique" UNIQUE("membership_id","idempotency_key"),
	CONSTRAINT "virtual_orders_amount_positive" CHECK ("virtual_orders"."amount" > 0),
	CONSTRAINT "virtual_orders_price_positive" CHECK ("virtual_orders"."price" > 0)
);
--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_events" ADD CONSTRAINT "platform_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_events" ADD CONSTRAINT "platform_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_progress" ADD CONSTRAINT "quest_progress_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_progress" ADD CONSTRAINT "quest_progress_quest_id_quests_id_fk" FOREIGN KEY ("quest_id") REFERENCES "public"."quests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_orders" ADD CONSTRAINT "virtual_orders_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_orders" ADD CONSTRAINT "virtual_orders_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leagues_tenant_id_status_index" ON "leagues" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "platform_events_tenant_id_type_occurred_at_index" ON "platform_events" USING btree ("tenant_id","type","occurred_at");--> statement-breakpoint
CREATE INDEX "virtual_orders_membership_id_created_at_index" ON "virtual_orders" USING btree ("membership_id","created_at");