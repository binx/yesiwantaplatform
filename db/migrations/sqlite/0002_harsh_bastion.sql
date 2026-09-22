ALTER TABLE `artists` ADD `banner_path` text;--> statement-breakpoint
ALTER TABLE `artists` ADD `banner_width` integer;--> statement-breakpoint
ALTER TABLE `artists` ADD `banner_height` integer;--> statement-breakpoint
ALTER TABLE `artists` ADD `banner_alt` text;--> statement-breakpoint
ALTER TABLE `artists` ADD `links` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `artists` ADD `term_months` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `term_months` integer DEFAULT 6 NOT NULL;