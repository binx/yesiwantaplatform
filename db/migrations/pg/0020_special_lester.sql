ALTER TABLE "store_settings" ADD COLUMN "storefront_access" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "storefront_password_hash" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "storefront_share_token" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "storefront_access_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "store_settings_share_token_idx" ON "store_settings" USING btree ("storefront_share_token");