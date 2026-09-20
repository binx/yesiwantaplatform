CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`last_login_at` integer,
	`password_reset_token_hash` text,
	`password_reset_expires_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_email_unique` ON `admin_users` (`email`);--> statement-breakpoint
CREATE TABLE `artists` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`tagline` text,
	`bio` text DEFAULT '' NOT NULL,
	`avatar_path` text,
	`avatar_width` integer,
	`avatar_height` integer,
	`avatar_alt` text,
	`monthly_price_cents` integer NOT NULL,
	`send_day` integer DEFAULT 15 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`stripe_account_id` text,
	`payouts_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artists_slug_idx` ON `artists` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `artists_customer_idx` ON `artists` (`customer_id`);--> statement-breakpoint
CREATE INDEX `artists_status_idx` ON `artists` (`status`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`name` text,
	`email_verified_at` integer,
	`email_verify_token_hash` text,
	`email_verify_expires_at` integer,
	`password_reset_token_hash` text,
	`password_reset_expires_at` integer,
	`last_login_at` integer,
	`address` text,
	`stripe_customer_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_email_unique` ON `customers` (`email`);--> statement-breakpoint
CREATE TABLE `mailings` (
	`id` text PRIMARY KEY NOT NULL,
	`artist_id` text NOT NULL,
	`design_id` text NOT NULL,
	`title` text,
	`mail_date` text NOT NULL,
	`period` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`in_gallery` integer DEFAULT true NOT NULL,
	`subscriber_count` integer DEFAULT 0 NOT NULL,
	`mailed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`design_id`) REFERENCES `postcard_designs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailings_artist_period_idx` ON `mailings` (`artist_id`,`period`);--> statement-breakpoint
CREATE INDEX `mailings_due_idx` ON `mailings` (`status`,`mail_date`);--> statement-breakpoint
CREATE INDEX `mailings_artist_idx` ON `mailings` (`artist_id`,`mail_date`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`stripe_invoice_id` text NOT NULL,
	`stripe_payment_intent_id` text,
	`status` text DEFAULT 'paid' NOT NULL,
	`amount_cents` integer NOT NULL,
	`refunded_cents` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_invoice_idx` ON `orders` (`stripe_invoice_id`);--> statement-breakpoint
CREATE INDEX `orders_subscription_idx` ON `orders` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `orders_artist_idx` ON `orders` (`artist_id`);--> statement-breakpoint
CREATE INDEX `orders_created_idx` ON `orders` (`created_at`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`is_live` integer DEFAULT false NOT NULL,
	`in_nav` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_slug_idx` ON `pages` (`slug`);--> statement-breakpoint
CREATE INDEX `pages_live_idx` ON `pages` (`is_live`);--> statement-breakpoint
CREATE TABLE `payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`artist_id` text NOT NULL,
	`postcard_id` text NOT NULL,
	`mailing_id` text NOT NULL,
	`gross_cents` integer NOT NULL,
	`print_cost_cents` integer NOT NULL,
	`platform_fee_cents` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stripe_transfer_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`paid_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`postcard_id`) REFERENCES `postcards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payouts_postcard_idx` ON `payouts` (`postcard_id`);--> statement-breakpoint
CREATE INDEX `payouts_artist_status_idx` ON `payouts` (`artist_id`,`status`);--> statement-breakpoint
CREATE INDEX `payouts_status_idx` ON `payouts` (`status`);--> statement-breakpoint
CREATE TABLE `postcard_designs` (
	`id` text PRIMARY KEY NOT NULL,
	`artist_id` text NOT NULL,
	`orientation` text NOT NULL,
	`print_path` text NOT NULL,
	`thumbnail_path` text NOT NULL,
	`thumbnail_width` integer NOT NULL,
	`thumbnail_height` integer NOT NULL,
	`back` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `postcard_designs_artist_idx` ON `postcard_designs` (`artist_id`);--> statement-breakpoint
CREATE INDEX `postcard_designs_created_idx` ON `postcard_designs` (`created_at`);--> statement-breakpoint
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
CREATE TABLE `postcards` (
	`id` text PRIMARY KEY NOT NULL,
	`mailing_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`design_id` text NOT NULL,
	`recipient_name` text NOT NULL,
	`recipient_line1` text NOT NULL,
	`recipient_line2` text,
	`recipient_city` text NOT NULL,
	`recipient_state` text NOT NULL,
	`recipient_postal_code` text NOT NULL,
	`recipient_country` text DEFAULT 'US' NOT NULL,
	`mail_date` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`lob_id` text,
	`lob_url` text,
	`expected_delivery_date` text,
	`sent_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`tracking_status` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`mailing_id`) REFERENCES `mailings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`design_id`) REFERENCES `postcard_designs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `postcards_mailing_subscription_idx` ON `postcards` (`mailing_id`,`subscription_id`);--> statement-breakpoint
CREATE INDEX `postcards_subscription_idx` ON `postcards` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `postcards_artist_idx` ON `postcards` (`artist_id`);--> statement-breakpoint
CREATE INDEX `postcards_due_idx` ON `postcards` (`status`,`mail_date`);--> statement-breakpoint
CREATE INDEX `postcards_lob_idx` ON `postcards` (`lob_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`sid` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `store_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`name` text DEFAULT 'Yes I Want A Postcard' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`stripe_publishable_key` text,
	`print_cost_cents` integer DEFAULT 120 NOT NULL,
	`platform_fee_cents` integer DEFAULT 60 NOT NULL,
	`min_monthly_price_cents` integer DEFAULT 300 NOT NULL,
	`return_address` text,
	`theme_color_primary` text DEFAULT '#1c1917' NOT NULL,
	`theme_color_accent` text DEFAULT '#f5c542' NOT NULL,
	`theme_font_family` text DEFAULT 'Quicksand, system-ui, sans-serif' NOT NULL,
	`theme_font_url` text,
	`theme_border_radius` integer DEFAULT 4 NOT NULL,
	`theme_color_scheme` text DEFAULT 'light' NOT NULL,
	`theme_color_page` text,
	`theme_logo_path` text,
	`theme_logo_width` integer,
	`theme_logo_height` integer,
	`theme_logo_alt` text,
	`hero_heading` text,
	`hero_text` text,
	`hero_button_label` text,
	`hero_button_href` text,
	`hero_image_path` text,
	`hero_image_width` integer,
	`hero_image_height` integer,
	`hero_image_alt` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`status` text DEFAULT 'incomplete' NOT NULL,
	`stripe_checkout_session_id` text NOT NULL,
	`stripe_subscription_id` text,
	`price_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`address` text NOT NULL,
	`cancelled_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_checkout_session_idx` ON `subscriptions` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_stripe_idx` ON `subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_customer_idx` ON `subscriptions` (`customer_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_artist_status_idx` ON `subscriptions` (`artist_id`,`status`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`received_at` integer DEFAULT (unixepoch()) NOT NULL
);
