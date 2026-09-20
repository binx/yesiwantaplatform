CREATE TABLE "admin_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"last_login_at" timestamp with time zone,
	"password_reset_token_hash" text,
	"password_reset_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_path" text,
	"avatar_width" integer,
	"avatar_height" integer,
	"avatar_alt" text,
	"monthly_price_cents" integer NOT NULL,
	"send_day" integer DEFAULT 15 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"stripe_account_id" text,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"name" text,
	"email_verified_at" timestamp with time zone,
	"email_verify_token_hash" text,
	"email_verify_expires_at" timestamp with time zone,
	"password_reset_token_hash" text,
	"password_reset_expires_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"address" jsonb,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "mailings" (
	"id" text PRIMARY KEY NOT NULL,
	"artist_id" text NOT NULL,
	"design_id" text NOT NULL,
	"title" text,
	"mail_date" text NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"in_gallery" boolean DEFAULT true NOT NULL,
	"subscriber_count" integer DEFAULT 0 NOT NULL,
	"mailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"artist_id" text NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"stripe_payment_intent_id" text,
	"status" text DEFAULT 'paid' NOT NULL,
	"amount_cents" integer NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"is_live" boolean DEFAULT false NOT NULL,
	"in_nav" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"artist_id" text NOT NULL,
	"postcard_id" text NOT NULL,
	"mailing_id" text NOT NULL,
	"gross_cents" integer NOT NULL,
	"print_cost_cents" integer NOT NULL,
	"platform_fee_cents" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stripe_transfer_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postcard_designs" (
	"id" text PRIMARY KEY NOT NULL,
	"artist_id" text NOT NULL,
	"orientation" text NOT NULL,
	"print_path" text NOT NULL,
	"thumbnail_path" text NOT NULL,
	"thumbnail_width" integer NOT NULL,
	"thumbnail_height" integer NOT NULL,
	"back" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postcard_tracking_events" (
	"id" text PRIMARY KEY NOT NULL,
	"postcard_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postcards" (
	"id" text PRIMARY KEY NOT NULL,
	"mailing_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"artist_id" text NOT NULL,
	"design_id" text NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_line1" text NOT NULL,
	"recipient_line2" text,
	"recipient_city" text NOT NULL,
	"recipient_state" text NOT NULL,
	"recipient_postal_code" text NOT NULL,
	"recipient_country" text DEFAULT 'US' NOT NULL,
	"mail_date" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"lob_id" text,
	"lob_url" text,
	"expected_delivery_date" text,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"tracking_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"data" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text DEFAULT 'Yes I Want A Postcard' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"stripe_publishable_key" text,
	"print_cost_cents" integer DEFAULT 120 NOT NULL,
	"platform_fee_cents" integer DEFAULT 60 NOT NULL,
	"min_monthly_price_cents" integer DEFAULT 300 NOT NULL,
	"return_address" jsonb,
	"theme_color_primary" text DEFAULT '#1c1917' NOT NULL,
	"theme_color_accent" text DEFAULT '#f5c542' NOT NULL,
	"theme_font_family" text DEFAULT 'Quicksand, system-ui, sans-serif' NOT NULL,
	"theme_font_url" text,
	"theme_border_radius" integer DEFAULT 4 NOT NULL,
	"theme_color_scheme" text DEFAULT 'light' NOT NULL,
	"theme_color_page" text,
	"theme_logo_path" text,
	"theme_logo_width" integer,
	"theme_logo_height" integer,
	"theme_logo_alt" text,
	"hero_heading" text,
	"hero_text" text,
	"hero_button_label" text,
	"hero_button_href" text,
	"hero_image_path" text,
	"hero_image_width" integer,
	"hero_image_height" integer,
	"hero_image_alt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"artist_id" text NOT NULL,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"stripe_checkout_session_id" text NOT NULL,
	"stripe_subscription_id" text,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"address" jsonb NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailings" ADD CONSTRAINT "mailings_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailings" ADD CONSTRAINT "mailings_design_id_postcard_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."postcard_designs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_postcard_id_postcards_id_fk" FOREIGN KEY ("postcard_id") REFERENCES "public"."postcards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postcard_designs" ADD CONSTRAINT "postcard_designs_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postcard_tracking_events" ADD CONSTRAINT "postcard_tracking_events_postcard_id_postcards_id_fk" FOREIGN KEY ("postcard_id") REFERENCES "public"."postcards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postcards" ADD CONSTRAINT "postcards_mailing_id_mailings_id_fk" FOREIGN KEY ("mailing_id") REFERENCES "public"."mailings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postcards" ADD CONSTRAINT "postcards_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postcards" ADD CONSTRAINT "postcards_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postcards" ADD CONSTRAINT "postcards_design_id_postcard_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."postcard_designs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artists_slug_idx" ON "artists" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "artists_customer_idx" ON "artists" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "artists_status_idx" ON "artists" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "mailings_artist_period_idx" ON "mailings" USING btree ("artist_id","period");--> statement-breakpoint
CREATE INDEX "mailings_due_idx" ON "mailings" USING btree ("status","mail_date");--> statement-breakpoint
CREATE INDEX "mailings_artist_idx" ON "mailings" USING btree ("artist_id","mail_date");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_invoice_idx" ON "orders" USING btree ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "orders_subscription_idx" ON "orders" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_artist_idx" ON "orders" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_slug_idx" ON "pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "pages_live_idx" ON "pages" USING btree ("is_live");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_postcard_idx" ON "payouts" USING btree ("postcard_id");--> statement-breakpoint
CREATE INDEX "payouts_artist_status_idx" ON "payouts" USING btree ("artist_id","status");--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "postcard_designs_artist_idx" ON "postcard_designs" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "postcard_designs_created_idx" ON "postcard_designs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "postcard_tracking_postcard_idx" ON "postcard_tracking_events" USING btree ("postcard_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "postcards_mailing_subscription_idx" ON "postcards" USING btree ("mailing_id","subscription_id");--> statement-breakpoint
CREATE INDEX "postcards_subscription_idx" ON "postcards" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "postcards_artist_idx" ON "postcards" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "postcards_due_idx" ON "postcards" USING btree ("status","mail_date");--> statement-breakpoint
CREATE INDEX "postcards_lob_idx" ON "postcards" USING btree ("lob_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_checkout_session_idx" ON "subscriptions" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_idx" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_customer_idx" ON "subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_artist_status_idx" ON "subscriptions" USING btree ("artist_id","status");