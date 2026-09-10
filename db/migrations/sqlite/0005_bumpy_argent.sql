CREATE TABLE `address_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`token` text NOT NULL,
	`label` text NOT NULL,
	`multi` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`notify_by_email` integer DEFAULT true NOT NULL,
	`responses` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `address_requests_token_idx` ON `address_requests` (`token`);--> statement-breakpoint
CREATE INDEX `address_requests_customer_idx` ON `address_requests` (`customer_id`);--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD `request_id` text;