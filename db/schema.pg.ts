import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Postgres mirror of `db/schema.sqlite.ts` — same tables, same column names.
 *
 * Differences are only where the dialects genuinely differ: real booleans,
 * `jsonb` instead of JSON-in-TEXT, and timestamptz instead of unix integers.
 * The repository normalises both to the same domain objects.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const storeSettings = pgTable("store_settings", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull().default("Postcard Gifts"),
  currency: text("currency").notNull().default("USD"),
  locale: text("locale").notNull().default("en-US"),
  stripePublishableKey: text("stripe_publishable_key"),
  postcardPriceCents: integer("postcard_price_cents").notNull().default(140),
  /** The price of a card mailed abroad. Null means the shop is US-only. */
  internationalPostcardPriceCents: integer("international_postcard_price_cents"),
  /** The shop's US address, in the recipient shape. Lob prints it as the return address on international mail. */
  returnAddress: jsonb("return_address"),
  cartRecoveryEnabled: boolean("cart_recovery_enabled").notNull().default(false),
  cartRecoveryDelayHours: integer("cart_recovery_delay_hours").notNull().default(4),
  themeColorPrimary: text("theme_color_primary").notNull().default("#333333"),
  themeColorAccent: text("theme_color_accent").notNull().default("#ffff37"),
  themeFontFamily: text("theme_font_family").notNull().default("Quicksand, system-ui, sans-serif"),
  themeFontUrl: text("theme_font_url"),
  themeBorderRadius: integer("theme_border_radius").notNull().default(2),
  themeColorScheme: text("theme_color_scheme").notNull().default("light"),
  themeColorPage: text("theme_color_page"),
  themeLogoPath: text("theme_logo_path"),
  themeLogoWidth: integer("theme_logo_width"),
  themeLogoHeight: integer("theme_logo_height"),
  themeLogoAlt: text("theme_logo_alt"),
  heroHeading: text("hero_heading"),
  heroText: text("hero_text"),
  heroButtonLabel: text("hero_button_label"),
  heroButtonHref: text("hero_button_href"),
  heroImagePath: text("hero_image_path"),
  heroImageWidth: integer("hero_image_width"),
  heroImageHeight: integer("hero_image_height"),
  heroImageAlt: text("hero_image_alt"),
  ...timestamps,
});

export const adminUsers = pgTable("admin_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at", { withTimezone: true }),
  ...timestamps,
});

export const customers = pgTable("customers", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  name: text("name"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  emailVerifyTokenHash: text("email_verify_token_hash"),
  emailVerifyExpiresAt: timestamp("email_verify_expires_at", { withTimezone: true }),
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  cartRecoveryOptOutAt: timestamp("cart_recovery_opt_out_at", { withTimezone: true }),
  cartRecoveryUnsubscribeTokenHash: text("cart_recovery_unsubscribe_token_hash"),
  ...timestamps,
});

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCode: text("postal_code").notNull(),
    country: text("country").notNull().default("US"),
    /** When Lob's verification last called this address deliverable. Null: never, or edited since. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    label: text("label"),
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    birthday: text("birthday"),
    notes: text("notes"),
    source: text("source").notNull().default("order"),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("customer_addresses_customer_idx").on(t.customerId)],
);

export const sessions = pgTable(
  "sessions",
  {
    sid: text("sid").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    data: text("data").notNull(),
  },
  (t) => [index("sessions_expires_at_idx").on(t.expiresAt)],
);

export const pages = pgTable(
  "pages",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    isLive: boolean("is_live").notNull().default(false),
    inNav: boolean("in_nav").notNull().default(false),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("pages_slug_idx").on(t.slug), index("pages_live_idx").on(t.isLive)],
);

export const postcardDesigns = pgTable(
  "postcard_designs",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    orderId: text("order_id"),
    orientation: text("orientation").notNull(),
    printPath: text("print_path"),
    thumbnailPath: text("thumbnail_path").notNull(),
    thumbnailWidth: integer("thumbnail_width").notNull(),
    thumbnailHeight: integer("thumbnail_height").notNull(),
    back: jsonb("back").notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => [
    index("postcard_designs_customer_idx").on(t.customerId),
    index("postcard_designs_order_idx").on(t.orderId),
    index("postcard_designs_created_idx").on(t.createdAt),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    email: text("email").notNull(),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    currency: text("currency").notNull().default("USD"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    postcardCount: integer("postcard_count").notNull(),
    /** How many of those went abroad, and the price each of them was charged at. */
    internationalCount: integer("international_count").notNull().default(0),
    internationalUnitPriceCents: integer("international_unit_price_cents"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    refundedCents: integer("refunded_cents").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_checkout_session_idx").on(t.stripeCheckoutSessionId),
    index("orders_status_idx").on(t.status),
    index("orders_created_idx").on(t.createdAt),
    index("orders_customer_idx").on(t.customerId),
    index("orders_email_idx").on(t.email),
  ],
);

export const postcards = pgTable(
  "postcards",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    designId: text("design_id")
      .notNull()
      .references(() => postcardDesigns.id),
    batchIndex: integer("batch_index").notNull().default(0),
    recipientName: text("recipient_name").notNull(),
    recipientLine1: text("recipient_line1").notNull(),
    recipientLine2: text("recipient_line2"),
    recipientCity: text("recipient_city").notNull(),
    recipientState: text("recipient_state").notNull(),
    recipientPostalCode: text("recipient_postal_code").notNull(),
    /** ISO 3166-1 alpha-2, what Lob's `address_country` takes. */
    recipientCountry: text("recipient_country").notNull().default("US"),
    mailDate: text("mail_date").notNull(),
    status: text("status").notNull().default("pending"),
    lobId: text("lob_id"),
    lobUrl: text("lob_url"),
    expectedDeliveryDate: text("expected_delivery_date"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** The latest tracking event Lob reported, as its `event_type.id`. See db/schema.sqlite.ts. */
    trackingStatus: text("tracking_status"),
    ...timestamps,
  },
  (t) => [
    index("postcards_order_idx").on(t.orderId),
    index("postcards_design_idx").on(t.designId),
    index("postcards_due_idx").on(t.status, t.mailDate),
  ],
);

export const postcardTrackingEvents = pgTable(
  "postcard_tracking_events",
  {
    id: text("id").primaryKey(),
    postcardId: text("postcard_id")
      .notNull()
      .references(() => postcards.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    location: text("location"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("postcard_tracking_postcard_idx").on(t.postcardId, t.occurredAt)],
);

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const carts = pgTable(
  "carts",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    lines: jsonb("lines").notNull().default(sql`'[]'::jsonb`),
    currency: text("currency").notNull(),
    recoveryTokenHash: text("recovery_token_hash"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("carts_customer_idx").on(t.customerId),
    index("carts_updated_idx").on(t.updatedAt),
  ],
);
