ALTER TABLE "customer_addresses" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "birthday" text;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "source" text DEFAULT 'order' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "last_sent_at" timestamp with time zone;