CREATE TABLE `shipping_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`country_codes` text DEFAULT '[]' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `shipping_rates` ADD `zone_id` text REFERENCES shipping_zones(id);--> statement-breakpoint
ALTER TABLE `shipping_rates` ADD `min_weight_grams` integer;--> statement-breakpoint
ALTER TABLE `shipping_rates` ADD `max_weight_grams` integer;--> statement-breakpoint
ALTER TABLE `shipping_rates` ADD `min_subtotal_cents` integer;--> statement-breakpoint
ALTER TABLE `shipping_rates` ADD `max_subtotal_cents` integer;--> statement-breakpoint
ALTER TABLE `variants` ADD `weight_grams` integer DEFAULT 0 NOT NULL;