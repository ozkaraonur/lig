ALTER TYPE "public"."league_type" ADD VALUE 'tier';--> statement-breakpoint
CREATE TABLE "tier_history" (
	"player_id" uuid NOT NULL,
	"league_id" uuid NOT NULL,
	"from_tier" text NOT NULL,
	"to_tier" text NOT NULL,
	"rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tier_history_player_id_league_id_pk" PRIMARY KEY("player_id","league_id"),
	CONSTRAINT "tier_history_known" CHECK ("tier_history"."from_tier" in ('bronze', 'silver', 'gold', 'platinum', 'legend') and "tier_history"."to_tier" in ('bronze', 'silver', 'gold', 'platinum', 'legend'))
);
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "tier_group" integer;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "tier" text DEFAULT 'bronze' NOT NULL;--> statement-breakpoint
ALTER TABLE "tier_history" ADD CONSTRAINT "tier_history_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier_history" ADD CONSTRAINT "tier_history_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leagues_tier_group_unique" ON "leagues" USING btree ("tenant_id","tier","starts_at","tier_group");--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_tier_shape" CHECK (("leagues"."type"::text = 'tier') = ("leagues"."tier" is not null and "leagues"."tier_group" is not null)
        and ("leagues"."type"::text <> 'tier' or "leagues"."max_members" between 2 and 50)
        and ("leagues"."tier" is null or "leagues"."tier" in ('bronze', 'silver', 'gold', 'platinum', 'legend')));--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_tier_known" CHECK ("players"."tier" in ('bronze', 'silver', 'gold', 'platinum', 'legend'));