ALTER TABLE "products" ADD COLUMN "tax_code" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "stripe_tax_signature" text;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD COLUMN "tax_behavior" text DEFAULT 'exclusive' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "tax_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "tax_behavior" text DEFAULT 'exclusive' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "default_tax_code" text DEFAULT 'txcd_99999999' NOT NULL;