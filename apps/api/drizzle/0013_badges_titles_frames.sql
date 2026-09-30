ALTER TYPE "public"."outbox_event_type" ADD VALUE 'badge_recheck';--> statement-breakpoint
CREATE TABLE "asset_limit_days" (
	"asset_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_limit_days_asset_id_session_date_pk" PRIMARY KEY("asset_id","session_date"),
	CONSTRAINT "asset_limit_days_kind_known" CHECK ("asset_limit_days"."kind" in ('limit_up', 'limit_down'))
);
--> statement-breakpoint
CREATE TABLE "player_badges" (
	"player_id" uuid NOT NULL,
	"badge_id" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_badges_player_id_badge_id_pk" PRIMARY KEY("player_id","badge_id"),
	CONSTRAINT "player_badges_badge_known" CHECK ("player_badges"."badge_id" in ('first_order', 'diverse_portfolio', 'quest_hunter', 'league_finisher', 'podium', 'limit_up_hunter'))
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "selected_title" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "selected_frame" text;--> statement-breakpoint
ALTER TABLE "asset_limit_days" ADD CONSTRAINT "asset_limit_days_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_limit_days" ADD CONSTRAINT "asset_limit_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_badges" ADD CONSTRAINT "player_badges_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_selected_title_known" CHECK ("players"."selected_title" is null or "players"."selected_title" in ('rookie', 'novice', 'experienced', 'portfolio_master', 'market_wolf'));--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_selected_frame_known" CHECK ("players"."selected_frame" is null or "players"."selected_frame" in ('starter', 'mosaic', 'compass', 'finish_line', 'laurel', 'limit_up'));