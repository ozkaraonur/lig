ALTER TABLE "leagues" ADD COLUMN "invite_code" text;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "owner_player_id" uuid;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_owner_player_id_players_id_fk" FOREIGN KEY ("owner_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_inviteCode_unique" UNIQUE("invite_code");--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_friends_shape" CHECK ("leagues"."type" <> 'friends' or ("leagues"."invite_code" is not null and "leagues"."max_members" is not null and "leagues"."max_members" between 2 and 10));--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_invite_only_friends" CHECK ("leagues"."invite_code" is null or "leagues"."type" = 'friends');