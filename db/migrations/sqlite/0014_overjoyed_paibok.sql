ALTER TABLE `store_settings` ADD `theme_color_scheme` text DEFAULT 'light' NOT NULL;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `theme_color_page` text;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `theme_logo_path` text;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `theme_logo_width` integer;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `theme_logo_height` integer;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `theme_logo_alt` text;--> statement-breakpoint
-- The radius cap dropped from 24 to 4; clamp rows written under the old one.
UPDATE `store_settings` SET `theme_border_radius` = 4 WHERE `theme_border_radius` > 4;