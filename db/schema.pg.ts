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
  /** @deprecated Superseded by the `pages` table. See db/schema.sqlite.ts. */
  aboutText: text("about_text"),
  /** Stripe Tax. Off by default — see the note in db/schema.sqlite.ts. */
  taxEnabled: boolean("tax_enabled").notNull().default(false),
  /** "exclusive" (added at checkout) | "inclusive" (already in the price). */
  taxBehavior: text("tax_behavior").notNull().default("exclusive"),
  /** Stripe tax code for products that do not set their own. */
  defaultTaxCode: text("default_tax_code").notNull().default("txcd_99999999"),
  /** Abandoned cart reminders. Off by default — see db/schema.sqlite.ts. */
  cartRecoveryEnabled: boolean("cart_recovery_enabled").notNull().default(false),
  /** Hours of inactivity before the one reminder goes out. */
  cartRecoveryDelayHours: integer("cart_recovery_delay_hours").notNull().default(4),
  themeColorPrimary: text("theme_color_primary").notNull().default("#18181b"),
  themeColorAccent: text("theme_color_accent").notNull().default("#e07a5f"),
  themeFontFamily: text("theme_font_family").notNull().default("system-ui, sans-serif"),
  themeBorderRadius: integer("theme_border_radius").notNull().default(2),
  themeColorScheme: text("theme_color_scheme").notNull().default("light"),
  /** Null means "follow the scheme". */
  themeColorPage: text("theme_color_page"),
  themeLogoPath: text("theme_logo_path"),
  themeLogoWidth: integer("theme_logo_width"),
  themeLogoHeight: integer("theme_logo_height"),
  themeLogoAlt: text("theme_logo_alt"),
  /*
   * The landing page's opening block.
   *
   * Copy, not look, which is why these are not `theme_*`: a shop changing its
   * palette is not changing its sentence. All nullable, and every reader has a
   * fallback — a store that sets none of them renders exactly as it did before
   * the columns existed. See `heroSchema` in shared/schema.ts.
   */
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
  /**
   * "owner" | "staff". A label today: every admin can do everything, and the
   * UI says so. The column exists now so gating it later is not a migration.
   */
  role: text("role").notNull().default("owner"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

/**
 * Single-use invitations to become an administrator.
 *
 * Only a hash of the token is stored, exactly as a password would be: a leaked
 * database must not hand someone an admin account. The raw token exists only
 * in the emailed link.
 */
export const adminInvites = pgTable("admin_invites", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull(),
  role: text("role").notNull().default("staff"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  ...timestamps,
});

/**
 * Storefront customers — distinct from `admin_users`.
 *
 * A customer session must never be mistaken for an admin one: it sets
 * `req.session.customerId`, a different flag from `adminId`, so `requireAdmin`
 * refuses it exactly as it would an anonymous caller.
 */
export const customers = pgTable("customers", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  /** argon2id, via the same path as admin_users. Never set until registration. */
  passwordHash: text("password_hash"),
  name: text("name"),
  stripeCustomerId: text("stripe_customer_id"),
  /**
   * Set once the emailed link is used. Orders are only ever linked to this
   * account after this is set — see `claimOrdersForCustomer` — so
   * registering with a stranger's address cannot read their order history.
   */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /** Hash only; the raw token lives in the emailed link. Single-use. */
  emailVerifyTokenHash: text("email_verify_token_hash"),
  emailVerifyExpiresAt: timestamp("email_verify_expires_at", { withTimezone: true }),
  /** Hash only, same reasoning as the invite tokens in `admin_invites`. */
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  /** Set once this customer clicks "unsubscribe" on a cart reminder. */
  cartRecoveryOptOutAt: timestamp("cart_recovery_opt_out_at", { withTimezone: true }),
  /** Hash only. See db/schema.sqlite.ts for why it's minted fresh per send. */
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
    name: text("name"),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    country: text("country").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
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
    /**
     * "physical" | "digital". A digital product has no weight and never ships,
     * so it is excluded from parcel weight and from shipping-address collection
     * — see shared/shipping.ts and server/routes/checkout.ts.
     */
    kind: text("kind").notNull().default("physical"),
    /**
     * @deprecated Superseded by `product_options`. Kept in sync with the first
     * option's name (or null) for one release, so a rollback still has a label.
     */
    variantName: text("variant_name"),
    /** Stripe tax code. Null uses the store default. */
    taxCode: text("tax_code"),
    isLive: boolean("is_live").notNull().default(false),
    stripeProductId: text("stripe_product_id"),
    /** `code|behavior` last published to Stripe. See db/schema.sqlite.ts. */
    stripeTaxSignature: text("stripe_tax_signature"),
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

/** A named axis: "Size". Up to 3 per product. */
export const productOptions = pgTable(
  "product_options",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_options_product_idx").on(t.productId)],
);

/** A value on that axis: "Large". */
export const productOptionValues = pgTable(
  "product_option_values",
  {
    id: text("id").primaryKey(),
    optionId: text("option_id")
      .notNull()
      .references(() => productOptions.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_option_values_option_idx").on(t.optionId)],
);

/** Which value on each axis this variant is. */
export const variantOptionValues = pgTable(
  "variant_option_values",
  {
    variantId: text("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    optionValueId: text("option_value_id")
      .notNull()
      .references(() => productOptionValues.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.variantId, t.optionValueId] })],
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
    /*
     * The collection's own introduction, as Markdown.
     *
     * Stored as source and rendered on the way out through
     * `server/markdown.ts`, the same as a page body — so tightening the
     * allow-list applies retroactively, and the storefront ships no parser.
     * Null for a collection that says nothing, which is every collection that
     * existed before this column.
     */
    description: text("description"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("collections_slug_idx").on(t.slug)],
);

/** Editable prose pages. See the note in db/schema.sqlite.ts. */
export const pages = pgTable(
  "pages",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** Markdown. Rendered to HTML at read time, never stored as HTML. */
    body: text("body").notNull().default(""),
    isLive: boolean("is_live").notNull().default(false),
    /** Show a link in the storefront banner. */
    inNav: boolean("in_nav").notNull().default(false),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("pages_slug_idx").on(t.slug), index("pages_live_idx").on(t.isLive)],
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
  /** Whether the rate's price already contains tax. Set per rate. */
  taxBehavior: text("tax_behavior").notNull().default("exclusive"),
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
    /**
     * Nullable: guest checkout is the default and stays supported. Set at
     * creation when the buyer was signed in, or linked afterwards by email —
     * see `claimOrdersForCustomer`, which only ever runs against a verified
     * customer.
     */
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
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
    index("orders_customer_idx").on(t.customerId),
    index("orders_email_idx").on(t.email),
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

/** Postgres mirror of `carts` in db/schema.sqlite.ts — see the comment there. */
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

/** Postgres mirror of `webhook_endpoints` in db/schema.sqlite.ts — see the comment there. */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    description: text("description").notNull().default(""),
    secret: text("secret").notNull(),
    eventTypes: jsonb("event_types").notNull().default(sql`'[]'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [index("webhook_endpoints_enabled_idx").on(t.enabled)],
);

/** Postgres mirror of `webhook_deliveries` in db/schema.sqlite.ts — see the comment there. */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    responseStatus: integer("response_status"),
    error: text("error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("webhook_deliveries_endpoint_idx").on(t.endpointId),
    index("webhook_deliveries_due_idx").on(t.nextAttemptAt),
  ],
);
