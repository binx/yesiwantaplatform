ALTER TABLE `artists` ADD `review_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `artists` ADD `review_note` text;--> statement-breakpoint
ALTER TABLE `artists` ADD `reviewed_at` integer;--> statement-breakpoint
ALTER TABLE `editions` ADD `review_note` text;--> statement-breakpoint
ALTER TABLE `editions` ADD `submitted_at` integer;--> statement-breakpoint
ALTER TABLE `editions` ADD `reviewed_at` integer;--> statement-breakpoint
UPDATE `artists` SET `review_status` = 'approved', `reviewed_at` = unixepoch() WHERE `status` IN ('live', 'paused');