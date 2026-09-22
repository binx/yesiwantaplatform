ALTER TABLE "artists" ADD COLUMN "banner_path" text;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "banner_width" integer;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "banner_height" integer;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "banner_alt" text;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "term_months" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "term_months" integer DEFAULT 6 NOT NULL;