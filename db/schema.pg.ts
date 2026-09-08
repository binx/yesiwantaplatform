import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
  name: text("name").notNull().default("My Store"),
  currency: text("currency").notNull().default("USD"),
  stripePublishableKey: text("stripe_publishable_key"),
  aboutText: text("about_text"),
  themeColorPrimary: text("theme_color_primary").notNull().default("#18181b"),
  themeColorAccent: text("theme_color_accent").notNull().default("#e07a5f"),
  themeFontFamily: text("theme_font_family").notNull().default("system-ui, sans-serif"),
  themeBorderRadius: integer("theme_border_radius").notNull().default(2),
  ...timestamps,
});

export const adminUsers = pgTable("admin_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

export const sessions = pgTable(
  "sessions",
  {
    sid: text("sid").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    data: text("data").notNull(),
  },
  (t) => [index("sessions_expires_at_idx").on(t.expiresAt)],
);

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    bulletPoints: jsonb("bullet_points").notNull().default(sql`'[]'::jsonb`),
    /** Overrides the generated tag. Null falls back to the product name. */
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    variantName: text("variant_name"),
    isLive: boolean("is_live").notNull().default(false),
    stripeProductId: text("stripe_product_id"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("products_slug_idx").on(t.slug), index("products_live_idx").on(t.isLive)],
);

export const variants = pgTable(
  "variants",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    label: text("label").notNull().default(""),
    priceCents: integer("price_cents").notNull(),
    inventoryType: text("inventory_type").notNull().default("infinite"),
    inventoryQuantity: integer("inventory_quantity").notNull().default(0),
    /** Shipping weight. Zero means the store has not recorded one. */
    weightGrams: integer("weight_grams").notNull().default(0),
    stripePriceId: text("stripe_price_id"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("variants_product_idx").on(t.productId)],
);

export const productImages = pgTable(
  "product_images",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** JSON array of the derivative widths generated for this image. */
    widths: jsonb("widths").notNull().default(sql`'[]'::jsonb`),
    alt: text("alt").notNull().default(""),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_images_product_idx").on(t.productId)],
);

export const optionGroups = pgTable(
  "option_groups",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    choices: jsonb("choices").notNull().default(sql`'[]'::jsonb`),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("option_groups_product_idx").on(t.productId)],
);

export const collections = pgTable(
  "collections",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    coverPath: text("cover_path"),
    coverWidth: integer("cover_width"),
    coverHeight: integer("cover_height"),
    coverAlt: text("cover_alt"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("collections_slug_idx").on(t.slug)],
);

export const collectionProducts = pgTable(
  "collection_products",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.productId] }),
    index("collection_products_collection_idx").on(t.collectionId),
  ],
);

export const shippingZones = pgTable("shipping_zones", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  countryCodes: jsonb("country_codes").notNull().default(sql`'[]'::jsonb`),
  position: integer("position").notNull().default(0),
  ...timestamps,
});

export const shippingRates = pgTable("shipping_rates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull().default(0),
  stripeShippingRateId: text("stripe_shipping_rate_id"),
  zoneId: text("zone_id").references(() => shippingZones.id, { onDelete: "cascade" }),
  minWeightGrams: integer("min_weight_grams"),
  maxWeightGrams: integer("max_weight_grams"),
  minSubtotalCents: integer("min_subtotal_cents"),
  maxSubtotalCents: integer("max_subtotal_cents"),
  isActive: boolean("is_active").notNull().default(true),
  position: integer("position").notNull().default(0),
  ...timestamps,
});

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    email: text("email").notNull(),
    status: text("status").notNull().default("pending"),
    currency: text("currency").notNull().default("USD"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    shippingCents: integer("shipping_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    /** Total discount applied at Stripe. Zero when no code was used. */
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    shippingName: text("shipping_name"),
    shippingLine1: text("shipping_line1"),
    shippingLine2: text("shipping_line2"),
    shippingCity: text("shipping_city"),
    shippingState: text("shipping_state"),
    shippingPostalCode: text("shipping_postal_code"),
    shippingCountry: text("shipping_country"),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    /** Payment succeeded but stock had gone; flagged for the owner. */
    oversold: boolean("oversold").notNull().default(false),
    /** Cumulative amount refunded. Less than totalCents means a partial refund. */
    refundedCents: integer("refunded_cents").notNull().default(0),
    /** Set once stock has been returned, so a second refund event is a no-op. */
    restockedAt: timestamp("restocked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_checkout_session_idx").on(t.stripeCheckoutSessionId),
    index("orders_status_idx").on(t.status),
    index("orders_created_idx").on(t.createdAt),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id"),
    variantId: text("variant_id"),
    productName: text("product_name").notNull(),
    variantLabel: text("variant_label").notNull().default(""),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    options: jsonb("options").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
