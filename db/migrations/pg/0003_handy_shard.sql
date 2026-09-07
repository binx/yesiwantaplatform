CREATE TABLE "shipping_zones" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD COLUMN "zone_id" text;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD COLUMN "min_weight_grams" integer;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD COLUMN "max_weight_grams" integer;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD COLUMN "min_subtotal_cents" integer;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD COLUMN "max_subtotal_cents" integer;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "weight_grams" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_zone_id_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."shipping_zones"("id") ON DELETE cascade ON UPDATE no action;