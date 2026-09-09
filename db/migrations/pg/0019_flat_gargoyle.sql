ALTER TABLE "admin_users" ADD COLUMN "password_reset_token_hash" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "password_reset_expires_at" timestamp with time zone;