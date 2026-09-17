CREATE TABLE "real_trade_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"league_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "real_trade_clicks" ADD CONSTRAINT "real_trade_clicks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_trade_clicks" ADD CONSTRAINT "real_trade_clicks_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_trade_clicks" ADD CONSTRAINT "real_trade_clicks_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "real_trade_clicks_tenant_id_created_at_index" ON "real_trade_clicks" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "real_trade_clicks_player_id_created_at_index" ON "real_trade_clicks" USING btree ("player_id","created_at");