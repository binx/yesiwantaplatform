CREATE TABLE `postcard_reactions` (
	`postcard_id` text PRIMARY KEY NOT NULL,
	`emoji` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`postcard_id`) REFERENCES `postcards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `customers` ADD `reply_address` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `reply_display_name` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `reply_to_postcard_id` text;--> statement-breakpoint
ALTER TABLE `postcards` ADD `reply_code` text;--> statement-breakpoint
ALTER TABLE `postcards` ADD `reply_disabled_at` integer;--> statement-breakpoint
ALTER TABLE `postcards` ADD `is_reply` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `postcards_reply_code_idx` ON `postcards` (`reply_code`);