ALTER TABLE "store_settings" ADD COLUMN "locale" text DEFAULT 'en-US' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "theme_font_url" text;