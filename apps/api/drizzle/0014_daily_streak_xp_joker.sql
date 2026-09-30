ALTER TYPE "public"."xp_reason" ADD VALUE 'streak';--> statement-breakpoint
ALTER TYPE "public"."xp_reason" ADD VALUE 'joker_bonus';--> statement-breakpoint
CREATE TABLE "player_activity_days" (
	"player_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_activity_days_player_id_day_pk" PRIMARY KEY("player_id","day")
);
--> statement-breakpoint
CREATE TABLE "xp_jokers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "xp_jokers_playerId_sourceId_unique" UNIQUE("player_id","source_id"),
	CONSTRAINT "xp_jokers_window" CHECK (("xp_jokers"."activated_at" is null) = ("xp_jokers"."expires_at" is null))
);
--> statement-breakpoint
ALTER TABLE "player_activity_days" ADD CONSTRAINT "player_activity_days_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_activity_days" ADD CONSTRAINT "player_activity_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_jokers" ADD CONSTRAINT "xp_jokers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_jokers" ADD CONSTRAINT "xp_jokers_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;