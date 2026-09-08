import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * SQLite schema. `db/schema.pg.ts` mirrors it for Postgres.
 *
 * Two rules run through the whole thing:
 *   - Money is an INTEGER number of cents. Never a float, never a REAL column.
 *   - Inventory lives here, not in Stripe. Stripe Prices carry no stock, which
 *     is precisely what v1 leaned on the removed SKUs API for.
 */

const timestamps = {
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch())`),
};

/** Single row (id = 1). Store-wide settings. */
export const storeSettings = sqliteTable("store_settings", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull().default("My Store"),
  currency: text("currency").notNull().default("USD"),
  /** Publishable key only — the secret key lives in the environment. */
  stripePublishableKey: text("stripe_publishable_key"),
  aboutText: text("about_text"),
  themeColorPrimary: text("theme_color_primary").notNull().default("#18181b"),
  themeColorAccent: text("theme_color_accent").notNull().default("#e07a5f"),
  themeFontFamily: text("theme_font_family").notNull().default("system-ui, sans-serif"),
  themeBorderRadius: integer("theme_border_radius").notNull().default(2),
  ...timestamps,
});

export const adminUsers = sqliteTable("admin_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  /** argon2id. v1 stored a bcrypt hash in config.env and rewrote that file. */
  passwordHash: text("password_hash").notNull(),
  lastLoginAt: integer("last_login_at"),
  ...timestamps,
});

/** Sessions in the database, not express-session's in-memory default. */
export const sessions = sqliteTable(
  "sessions",
  {
    sid: text("sid").primaryKey(),
    expiresAt: integer("expires_at").notNull(),
    data: text("data").notNull(),
  },
  (t) => [index("sessions_expires_at_idx").on(t.expiresAt)],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** JSON array of strings. */
    bulletPoints: text("bullet_points").notNull().default("[]"),
    /** Label for the variant axis, e.g. "size". Null for single-variant products. */
    variantName: text("variant_name"),
    isLive: integer("is_live", { mode: "boolean" }).notNull().default(false),
    stripeProductId: text("stripe_product_id"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("products_slug_idx").on(t.slug), index("products_live_idx").on(t.isLive)],
);

export const variants = sqliteTable(
  "variants",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    label: text("label").notNull().default(""),
    priceCents: integer("price_cents").notNull(),
    /** "infinite" | "finite" */
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

export const productImages = sqliteTable(
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
    widths: text("widths").notNull().default("[]"),
    /** Required, so imagery is never unlabelled for screen readers. */
    alt: text("alt").notNull().default(""),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_images_product_idx").on(t.productId)],
);

/** Non-priced choices, e.g. gift wrap. v1 conflated these with priced SKUs. */
export const optionGroups = sqliteTable(
  "option_groups",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** JSON array of strings. */
    choices: text("choices").notNull().default("[]"),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("option_groups_product_idx").on(t.productId)],
);

export const collections = sqliteTable(
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

export const collectionProducts = sqliteTable(
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

/** Phase 3 populates these; the schema lands now so migrations settle early. */
/**
 * A group of countries priced together.
 *
 * A zone with no countries is the catch-all, so a store can price "everywhere
 * else" without enumerating the world.
 */
export const shippingZones = sqliteTable("shipping_zones", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** JSON array of ISO 3166-1 alpha-2 codes. */
  countryCodes: text("country_codes").notNull().default("[]"),
  position: integer("position").notNull().default(0),
  ...timestamps,
});

/**
 * A shipping rate, optionally bounded by zone, weight and subtotal.
 *
 * Null bounds mean unbounded, and a null `zone_id` applies the rate
 * everywhere — which is what lets a flat-rate store work with no zones at all.
 */
export const shippingRates = sqliteTable("shipping_rates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull().default(0),
  stripeShippingRateId: text("stripe_shipping_rate_id"),
  zoneId: text("zone_id").references(() => shippingZones.id, { onDelete: "cascade" }),
  minWeightGrams: integer("min_weight_grams"),
  maxWeightGrams: integer("max_weight_grams"),
  minSubtotalCents: integer("min_subtotal_cents"),
  maxSubtotalCents: integer("max_subtotal_cents"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  position: integer("position").notNull().default(0),
  ...timestamps,
});

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    email: text("email").notNull(),
    /** pending | paid | processing | shipped | cancelled | refunded */
    status: text("status").notNull().default("pending"),
    currency: text("currency").notNull().default("USD"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    shippingCents: integer("shipping_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
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
    oversold: integer("oversold", { mode: "boolean" }).notNull().default(false),
    /** Cumulative amount refunded. Less than totalCents means a partial refund. */
    refundedCents: integer("refunded_cents").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_checkout_session_idx").on(t.stripeCheckoutSessionId),
    index("orders_status_idx").on(t.status),
    index("orders_created_idx").on(t.createdAt),
  ],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Nullable: the catalogue may change after the sale. */
    productId: text("product_id"),
    variantId: text("variant_id"),
    /** Snapshots, so an order always renders as it was bought. */
    productName: text("product_name").notNull(),
    variantLabel: text("variant_label").notNull().default(""),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    /** JSON object of non-priced selections. */
    options: text("options").notNull().default("{}"),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

/**
 * Stripe delivers webhooks at least once. Recording event ids makes replay a
 * no-op instead of a duplicate order.
 */
export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: integer("received_at")
    .notNull()
    .default(sql`(unixepoch())`),
});
