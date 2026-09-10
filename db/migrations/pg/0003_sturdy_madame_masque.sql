CREATE TABLE "postcard_tracking_events" (
	"id" text PRIMARY KEY NOT NULL,
	"postcard_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "postcards" ADD COLUMN "tracking_status" text;--> statement-breakpoint
ALTER TABLE "postcard_tracking_events" ADD CONSTRAINT "postcard_tracking_events_postcard_id_postcards_id_fk" FOREIGN KEY ("postcard_id") REFERENCES "public"."postcards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "postcard_tracking_postcard_idx" ON "postcard_tracking_events" USING btree ("postcard_id","occurred_at");