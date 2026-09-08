ALTER TABLE `products` ADD `tax_code` text;--> statement-breakpoint
ALTER TABLE `products` ADD `stripe_tax_signature` text;--> statement-breakpoint
ALTER TABLE `shipping_rates` ADD `tax_behavior` text DEFAULT 'exclusive' NOT NULL;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `tax_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `tax_behavior` text DEFAULT 'exclusive' NOT NULL;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `default_tax_code` text DEFAULT 'txcd_99999999' NOT NULL;