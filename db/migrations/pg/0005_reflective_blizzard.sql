CREATE TABLE "address_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"token" text NOT NULL,
	"label" text NOT NULL,
	"multi" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"notify_by_email" boolean DEFAULT true NOT NULL,
	"responses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "address_requests" ADD CONSTRAINT "address_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "address_requests_token_idx" ON "address_requests" USING btree ("token");--> statement-breakpoint
CREATE INDEX "address_requests_customer_idx" ON "address_requests" USING btree ("customer_id");