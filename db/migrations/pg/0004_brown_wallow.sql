ALTER TABLE "artists" ADD COLUMN "review_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "artists" SET "review_status" = 'approved', "reviewed_at" = now() WHERE "status" IN ('live', 'paused');