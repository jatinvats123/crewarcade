ALTER TABLE "bugs" ADD COLUMN "number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "bugs" ADD COLUMN "card_message_id" text;--> statement-breakpoint
ALTER TABLE "bugs" ADD COLUMN "reported_on_version" integer;--> statement-breakpoint
ALTER TABLE "bugs" ADD COLUMN "hotfix_version" integer;--> statement-breakpoint
ALTER TABLE "bugs" ADD COLUMN "question" text;