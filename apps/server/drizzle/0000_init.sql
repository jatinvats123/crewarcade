CREATE TABLE "bugs" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"reporter_id" text NOT NULL,
	"description" text NOT NULL,
	"screenshot_path" text,
	"repro_scenario" jsonb,
	"reproduced_on_version" integer,
	"fixed_in_version" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bugs_status_check" CHECK ("bugs"."status" in ('open', 'reproduced', 'not_reproduced', 'fixed'))
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"nexconn_message_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"card_type" text NOT NULL,
	"game_id" text,
	"version" integer,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"event_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"os" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crew_members" (
	"crew_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crew_members_crew_id_user_id_pk" PRIMARY KEY("crew_id","user_id"),
	CONSTRAINT "crew_members_role_check" CHECK ("crew_members"."role" in ('owner', 'approver', 'member'))
);
--> statement-breakpoint
CREATE TABLE "crews" (
	"id" text PRIMARY KEY NOT NULL,
	"group_channel_id" text NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"invite_code" text NOT NULL,
	"kind" text DEFAULT 'crew' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "crews_groupChannelId_unique" UNIQUE("group_channel_id"),
	CONSTRAINT "crews_inviteCode_unique" UNIQUE("invite_code"),
	CONSTRAINT "crews_kind_check" CHECK ("crews"."kind" in ('crew', 'classroom'))
);
--> statement-breakpoint
CREATE TABLE "game_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"version" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"html_path" text,
	"size_bytes" integer,
	"check_result" jsonb,
	"scenario" jsonb,
	"playtest" jsonb,
	"gif_path" text,
	"screenshot_path" text,
	"build_ms" integer,
	"test_ms" integer,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'building' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"notes" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "game_versions_status_check" CHECK ("game_versions"."status" in ('building', 'check_failed', 'testing', 'passed', 'failed', 'published')),
	CONSTRAINT "game_versions_version_check" CHECK ("game_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"crew_id" text NOT NULL,
	"room_channel_id" text,
	"title" text NOT NULL,
	"pitch" text NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"remix_of_game_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_version" integer,
	CONSTRAINT "games_slug_unique" UNIQUE("slug"),
	CONSTRAINT "games_roomChannelId_unique" UNIQUE("room_channel_id"),
	CONSTRAINT "games_status_check" CHECK ("games"."status" in ('planning', 'building', 'testing', 'awaiting_approval', 'published', 'failed')),
	CONSTRAINT "games_slug_check" CHECK ("games"."slug" ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$')
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text,
	"crew_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"reason" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_actor_type_check" CHECK ("ledger"."actor_type" in ('agent', 'human', 'system')),
	CONSTRAINT "ledger_action_check" CHECK ("ledger"."action" ~ '^[a-z_]+\.[a-z_]+$' or "ledger"."action" = 'handoff')
);
--> statement-breakpoint
CREATE TABLE "live_rooms" (
	"open_channel_id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"peak_viewers" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages_log" (
	"nexconn_message_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"channel_type" integer NOT NULL,
	"from_user_id" text NOT NULL,
	"message_type" text NOT NULL,
	"text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_log" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rule" text NOT NULL,
	"action" text NOT NULL,
	"excerpt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_log_action_check" CHECK ("moderation_log"."action" in ('blocked', 'masked', 'flagged'))
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"version" integer NOT NULL,
	"user_id" text NOT NULL,
	"score" integer NOT NULL,
	"time_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage" (
	"day" date NOT NULL,
	"user_id" text NOT NULL,
	"builds" integer DEFAULT 0 NOT NULL,
	"translations_chars" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_day_user_id_pk" PRIMARY KEY("day","user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"avatar_emoji" text DEFAULT '🙂' NOT NULL,
	"avatar_color" text DEFAULT 'violet' NOT NULL,
	"avatar_url" text,
	"language" text DEFAULT 'en' NOT NULL,
	"auto_translate" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"nexconn_token_encrypted" text,
	"is_agent" boolean DEFAULT false NOT NULL,
	"is_judge" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_versions" ADD CONSTRAINT "game_versions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_remix_of_game_id_games_id_fk" FOREIGN KEY ("remix_of_game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_rooms" ADD CONSTRAINT "live_rooms_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bugs_game_idx" ON "bugs" USING btree ("game_id","status");--> statement-breakpoint
CREATE INDEX "cards_channel_idx" ON "cards" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "cards_game_idx" ON "cards" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "connections_user_idx" ON "connections" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "connections_at_idx" ON "connections" USING btree ("at");--> statement-breakpoint
CREATE INDEX "crew_members_user_idx" ON "crew_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "crews_owner_idx" ON "crews" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_versions_game_version_uq" ON "game_versions" USING btree ("game_id","version");--> statement-breakpoint
CREATE INDEX "games_crew_idx" ON "games" USING btree ("crew_id");--> statement-breakpoint
CREATE INDEX "games_published_idx" ON "games" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ledger_game_idx" ON "ledger" USING btree ("game_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_crew_idx" ON "ledger" USING btree ("crew_id","created_at");--> statement-breakpoint
CREATE INDEX "live_rooms_game_idx" ON "live_rooms" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "messages_log_channel_idx" ON "messages_log" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_log_created_idx" ON "messages_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "moderation_log_channel_idx" ON "moderation_log" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "scores_game_score_idx" ON "scores" USING btree ("game_id","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scores_user_idx" ON "scores" USING btree ("user_id");