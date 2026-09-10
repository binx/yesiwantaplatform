ALTER TABLE `orders` ADD `international_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `international_unit_price_cents` integer;--> statement-breakpoint
ALTER TABLE `postcards` ADD `recipient_country` text DEFAULT 'US' NOT NULL;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `international_postcard_price_cents` integer;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `return_address` text;