-- Elle düzenlendi: drizzle-kit birincil anahtarı period_key kolonu eklenmeden önce kurmaya çalışıyordu.
CREATE TYPE "public"."outbox_event_type" AS ENUM('order_placed', 'league_joined', 'platform_event');--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"type" "outbox_event_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "quest_progress" DROP CONSTRAINT "quest_progress_player_id_quest_id_pk";--> statement-breakpoint
ALTER TABLE "platform_events" ADD COLUMN "external_player_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "quest_progress" ADD COLUMN "period_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "quest_progress" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "quest_progress" ADD CONSTRAINT "quest_progress_player_id_quest_id_period_key_pk" PRIMARY KEY("player_id","quest_id","period_key");--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "period" text DEFAULT 'once' NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "webhook_secret" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "real_trade_url" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("available_at") WHERE "outbox_events"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "quests_tenant_id_active_index" ON "quests" USING btree ("tenant_id","active");--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_template_known" CHECK ("quests"."template" in ('join_league', 'place_orders', 'trade_distinct_assets', 'real_trade'));--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_period_known" CHECK ("quests"."period" in ('once', 'weekly'));--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_target_positive" CHECK ("quests"."target_count" > 0);--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_xp_positive" CHECK ("quests"."xp_reward" > 0);