ALTER TABLE "leagues" ADD COLUMN "max_members" integer;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "late_join_allowed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "real_trade_button_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "real_trade_quest_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_max_members_positive" CHECK ("leagues"."max_members" is null or "leagues"."max_members" > 0);