CREATE TYPE "public"."xp_reason" AS ENUM('league_rank', 'league_participation', 'quest');--> statement-breakpoint
CREATE TABLE "xp_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"reason" "xp_reason" NOT NULL,
	"source_id" text NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_ledger_playerId_reason_sourceId_unique" UNIQUE("player_id","reason","source_id"),
	CONSTRAINT "xp_ledger_amount_positive" CHECK ("xp_ledger"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "closing_prices" jsonb;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "final_value" numeric(20, 2);--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "xp_ledger_player_id_created_at_index" ON "xp_ledger" USING btree ("player_id","created_at");