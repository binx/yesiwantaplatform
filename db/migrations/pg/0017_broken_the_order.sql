ALTER TABLE "collections" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "hero_heading" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "hero_text" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "hero_button_label" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "hero_button_href" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "hero_image_path" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "hero_image_width" integer;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "hero_image_height" integer;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "hero_image_alt" text;