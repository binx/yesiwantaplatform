ALTER TABLE `customers` ADD `reply_address` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `reply_display_name` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `reply_to_postcard_id` text;--> statement-breakpoint
ALTER TABLE `postcards` ADD `reply_code` text;--> statement-breakpoint
ALTER TABLE `postcards` ADD `reply_disabled_at` integer;--> statement-breakpoint
ALTER TABLE `postcards` ADD `is_reply` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `postcards_reply_code_idx` ON `postcards` (`reply_code`);