ALTER TABLE "order_items" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "variant_id" text;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "compare_at_price_cents" integer;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "variants_sku_idx" ON "variants" USING btree ("sku") WHERE "variants"."sku" is not null;