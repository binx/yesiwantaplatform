ALTER TABLE `admin_users` ADD `password_reset_token_hash` text;--> statement-breakpoint
ALTER TABLE `admin_users` ADD `password_reset_expires_at` integer;