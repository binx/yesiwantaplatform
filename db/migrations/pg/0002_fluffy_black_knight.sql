ALTER TABLE "store_settings" ADD COLUMN "platform_fee_percent" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" DROP COLUMN "platform_fee_cents";