ALTER TABLE `order_items` ADD `sku` text;--> statement-breakpoint
ALTER TABLE `product_images` ADD `variant_id` text REFERENCES variants(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `variants` ADD `sku` text;--> statement-breakpoint
ALTER TABLE `variants` ADD `compare_at_price_cents` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `variants_sku_idx` ON `variants` (`sku`) WHERE "variants"."sku" is not null;