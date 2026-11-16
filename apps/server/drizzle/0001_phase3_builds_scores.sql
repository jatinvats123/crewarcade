CREATE TABLE "challenge_dms" (
	"winner_id" text NOT NULL,
	"beaten_id" text NOT NULL,
	"game_id" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "challenge_dms_winner_id_beaten_id_pk" PRIMARY KEY("winner_id","beaten_id")
);
--> statement-breakpoint
ALTER TABLE "game_versions" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "game_versions" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "challenge_dms" ADD CONSTRAINT "challenge_dms_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_dms" ADD CONSTRAINT "challenge_dms_beaten_id_users_id_fk" FOREIGN KEY ("beaten_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_dms" ADD CONSTRAINT "challenge_dms_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scores_user_game_time_idx" ON "scores" USING btree ("user_id","game_id","created_at");