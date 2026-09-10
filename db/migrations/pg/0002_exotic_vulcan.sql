ALTER TABLE "orders" ADD COLUMN "international_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "international_unit_price_cents" integer;--> statement-breakpoint
ALTER TABLE "postcards" ADD COLUMN "recipient_country" text DEFAULT 'US' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "international_postcard_price_cents" integer;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "return_address" jsonb;