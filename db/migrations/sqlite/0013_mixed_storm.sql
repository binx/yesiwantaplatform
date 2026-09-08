CREATE TABLE `carts` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`email` text NOT NULL,
	`lines` text DEFAULT '[]' NOT NULL,
	`currency` text NOT NULL,
	`recovery_token_hash` text,
	`reminder_sent_at` integer,
	`recovered_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `carts_customer_idx` ON `carts` (`customer_id`);--> statement-breakpoint
CREATE INDEX `carts_updated_idx` ON `carts` (`updated_at`);--> statement-breakpoint
ALTER TABLE `customers` ADD `cart_recovery_opt_out_at` integer;--> statement-breakpoint
ALTER TABLE `customers` ADD `cart_recovery_unsubscribe_token_hash` text;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `cart_recovery_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `cart_recovery_delay_hours` integer DEFAULT 4 NOT NULL;