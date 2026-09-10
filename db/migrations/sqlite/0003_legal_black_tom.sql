CREATE TABLE `postcard_tracking_events` (
	`id` text PRIMARY KEY NOT NULL,
	`postcard_id` text NOT NULL,
	`type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`location` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`postcard_id`) REFERENCES `postcards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `postcard_tracking_postcard_idx` ON `postcard_tracking_events` (`postcard_id`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `postcards` ADD `tracking_status` text;