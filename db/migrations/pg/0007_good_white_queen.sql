CREATE TABLE "postcard_reactions" (
	"postcard_id" text PRIMARY KEY NOT NULL,
	"emoji" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "reply_address" jsonb;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "reply_display_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "reply_to_postcard_id" text;--> statement-breakpoint
ALTER TABLE "postcards" ADD COLUMN "reply_code" text;--> statement-breakpoint
ALTER TABLE "postcards" ADD COLUMN "reply_disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "postcards" ADD COLUMN "is_reply" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "postcard_reactions" ADD CONSTRAINT "postcard_reactions_postcard_id_postcards_id_fk" FOREIGN KEY ("postcard_id") REFERENCES "public"."postcards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "postcards_reply_code_idx" ON "postcards" USING btree ("reply_code");