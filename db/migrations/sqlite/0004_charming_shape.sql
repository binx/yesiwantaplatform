ALTER TABLE `customer_addresses` ADD `label` text;--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD `birthday` text;--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD `source` text DEFAULT 'order' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD `last_sent_at` integer;