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
CREATE TABLE `customer_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`name` text NOT NULL,
	`line1` text NOT NULL,
	`line2` text,
	`city` text NOT NULL,
	`state` text NOT NULL,
	`postal_code` text NOT NULL,
	`country` text DEFAULT 'US' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `customer_addresses_customer_idx` ON `customer_addresses` (`customer_id`);--> statement-breakpoint
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
	`cart_recovery_opt_out_at` integer,
	`cart_recovery_unsubscribe_token_hash` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_email_unique` ON `customers` (`email`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`stripe_checkout_session_id` text NOT NULL,
	`stripe_payment_intent_id` text,
	`email` text NOT NULL,
	`customer_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`postcard_count` integer NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`refunded_cents` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_checkout_session_idx` ON `orders` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_created_idx` ON `orders` (`created_at`);--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `orders_email_idx` ON `orders` (`email`);--> statement-breakpoint
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
CREATE TABLE `postcard_designs` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`order_id` text,
	`orientation` text NOT NULL,
	`print_path` text,
	`thumbnail_path` text NOT NULL,
	`thumbnail_width` integer NOT NULL,
	`thumbnail_height` integer NOT NULL,
	`back` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `postcard_designs_customer_idx` ON `postcard_designs` (`customer_id`);--> statement-breakpoint
CREATE INDEX `postcard_designs_order_idx` ON `postcard_designs` (`order_id`);--> statement-breakpoint
CREATE INDEX `postcard_designs_created_idx` ON `postcard_designs` (`created_at`);--> statement-breakpoint
CREATE TABLE `postcards` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`design_id` text NOT NULL,
	`batch_index` integer DEFAULT 0 NOT NULL,
	`recipient_name` text NOT NULL,
	`recipient_line1` text NOT NULL,
	`recipient_line2` text,
	`recipient_city` text NOT NULL,
	`recipient_state` text NOT NULL,
	`recipient_postal_code` text NOT NULL,
	`mail_date` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`lob_id` text,
	`lob_url` text,
	`expected_delivery_date` text,
	`sent_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`design_id`) REFERENCES `postcard_designs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `postcards_order_idx` ON `postcards` (`order_id`);--> statement-breakpoint
CREATE INDEX `postcards_design_idx` ON `postcards` (`design_id`);--> statement-breakpoint
CREATE INDEX `postcards_due_idx` ON `postcards` (`status`,`mail_date`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`sid` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `store_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`name` text DEFAULT 'Postcard Gifts' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`stripe_publishable_key` text,
	`postcard_price_cents` integer DEFAULT 140 NOT NULL,
	`cart_recovery_enabled` integer DEFAULT false NOT NULL,
	`cart_recovery_delay_hours` integer DEFAULT 4 NOT NULL,
	`theme_color_primary` text DEFAULT '#333333' NOT NULL,
	`theme_color_accent` text DEFAULT '#ffff37' NOT NULL,
	`theme_font_family` text DEFAULT 'Quicksand, system-ui, sans-serif' NOT NULL,
	`theme_font_url` text,
	`theme_border_radius` integer DEFAULT 2 NOT NULL,
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
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`received_at` integer DEFAULT (unixepoch()) NOT NULL
);
