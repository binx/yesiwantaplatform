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
  /**
   * @deprecated Superseded by the `pages` table. Kept for one release so an
   * install that rolls back still has its About copy; `db/migrate.ts` copies
   * it into a page on first run of the migration that added them.
   */
  aboutText: text("about_text"),
  /**
   * Tax, via Stripe Tax.
   *
   * Off by default and deliberately not on a switch the merchant can flip
   * without reading: Stripe Tax is a paid add-on, and the registrations that
   * make it correct are theirs to create. Beluga calculates nothing itself.
   */
  taxEnabled: integer("tax_enabled", { mode: "boolean" }).notNull().default(false),
  /** "exclusive" (added at checkout) | "inclusive" (already in the price). */
  taxBehavior: text("tax_behavior").notNull().default("exclusive"),
  /** Stripe tax code for products that do not set their own. */
  defaultTaxCode: text("default_tax_code").notNull().default("txcd_99999999"),
  /**
   * Abandoned cart reminders. Off by default — see the Settings copy: the
   * merchant must opt in, and the email goes out under their own SMTP sending
   * reputation, not Beluga's.
   */
  cartRecoveryEnabled: integer("cart_recovery_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
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

export const adminUsers = sqliteTable("admin_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  /** argon2id. v1 stored a bcrypt hash in config.env and rewrote that file. */
  passwordHash: text("password_hash").notNull(),
  /**
   * "owner" | "staff". A label today: every admin can do everything, and the
   * UI says so. The column exists now so gating it later is not a migration.
   */
  role: text("role").notNull().default("owner"),
  lastLoginAt: integer("last_login_at"),
  ...timestamps,
});

/**
 * Single-use invitations to become an administrator.
 *
 * Only a hash of the token is stored, exactly as a password would be: a leaked
 * database must not hand someone an admin account. The raw token exists only
 * in the emailed link.
 */
export const adminInvites = sqliteTable("admin_invites", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull(),
  role: text("role").notNull().default("staff"),
  expiresAt: integer("expires_at").notNull(),
  acceptedAt: integer("accepted_at"),
  ...timestamps,
});

/**
 * Storefront customers — distinct from `admin_users`.
 *
 * A customer session must never be mistaken for an admin one: it sets
 * `req.session.customerId`, a different flag from `adminId`, so `requireAdmin`
 * refuses it exactly as it would an anonymous caller.
 */
export const customers = sqliteTable("customers", {
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
  emailVerifiedAt: integer("email_verified_at"),
  /** Hash only; the raw token lives in the emailed link. Single-use. */
  emailVerifyTokenHash: text("email_verify_token_hash"),
  emailVerifyExpiresAt: integer("email_verify_expires_at"),
  /** Hash only, same reasoning as the invite tokens in `admin_invites`. */
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: integer("password_reset_expires_at"),
  lastLoginAt: integer("last_login_at"),
  /** Set once this customer clicks "unsubscribe" on a cart reminder. */
  cartRecoveryOptOutAt: integer("cart_recovery_opt_out_at"),
  /**
   * Hash only. Minted fresh on every reminder send rather than once at
   * registration, so there is nothing to provision for customers who never
   * get a reminder. An older email's unsubscribe link stops working once a
   * newer one is sent — the same trade-off the password-reset token already
   * makes, and low-stakes here since clicking it only ever opts out.
   */
  cartRecoveryUnsubscribeTokenHash: text("cart_recovery_unsubscribe_token_hash"),
  ...timestamps,
});

export const customerAddresses = sqliteTable(
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
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [index("customer_addresses_customer_idx").on(t.customerId)],
);

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
    isLive: integer("is_live", { mode: "boolean" }).notNull().default(false),
    stripeProductId: text("stripe_product_id"),
    /**
     * The tax configuration this product was last published to Stripe under,
     * as `code|behavior`.
     *
     * Recorded because `tax_behavior` is immutable on a Stripe Price: changing
     * it means new Prices, which only happens on an explicit publish. Without
     * this there is no way to tell a product that carries the store's current
     * tax settings from one published before they changed — and auto-publishing
     * to find out would write to a live Stripe account unasked.
     */
    stripeTaxSignature: text("stripe_tax_signature"),
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

/** A named axis: "Size". Up to 3 per product. */
export const productOptions = sqliteTable(
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
export const productOptionValues = sqliteTable(
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
export const variantOptionValues = sqliteTable(
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

/**
 * Editable prose pages — returns policy, shipping information, contact.
 *
 * Replaces the single `aboutText` column, which could hold exactly one page
 * and no title. Bodies are Markdown and are rendered to HTML at read time;
 * nothing here is ever stored as HTML, so a change to the sanitiser applies
 * retroactively to everything already written.
 */
export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** Markdown. Rendered to HTML at read time, never stored as HTML. */
    body: text("body").notNull().default(""),
    isLive: integer("is_live", { mode: "boolean" }).notNull().default(false),
    /** Show a link in the storefront banner. */
    inNav: integer("in_nav", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("pages_slug_idx").on(t.slug), index("pages_live_idx").on(t.isLive)],
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
  /**
   * Whether the rate's price already contains tax. Shipping is taxable in some
   * jurisdictions and not others, so it is set per rate rather than inherited.
   */
  taxBehavior: text("tax_behavior").notNull().default("exclusive"),
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
    /**
     * Nullable: guest checkout is the default and stays supported. Set at
     * creation when the buyer was signed in, or linked afterwards by email —
     * see `claimOrdersForCustomer`, which only ever runs against a verified
     * customer.
     */
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** pending | paid | processing | shipped | cancelled | refunded */
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
    oversold: integer("oversold", { mode: "boolean" }).notNull().default(false),
    /** Cumulative amount refunded. Less than totalCents means a partial refund. */
    refundedCents: integer("refunded_cents").notNull().default(0),
    /** Set once stock has been returned, so a second refund event is a no-op. */
    restockedAt: integer("restocked_at"),
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

/**
 * A signed-in customer's cart, mirrored server-side so there is something to
 * remind them about — see docs/tasks/12-abandoned-cart.md.
 *
 * Only ever populated for a customer with an account: a guest's cart never
 * reaches the server before checkout, so there is no address to contact and
 * nothing worth storing. `customerId` is NOT NULL for that reason, unlike the
 * brief's own sketch of this table, which left room for an anonymous-with-email
 * case this codebase has no way to produce.
 *
 * At most one *active* (unrecovered) row per customer — see
 * `db/carts-repository.ts`'s `upsertActiveCart`. `reminderSentAt` doubles as
 * "when the recovery token was minted," so its 7-day expiry needs no column
 * of its own.
 */
export const carts = sqliteTable(
  "carts",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** Snapshot of the customer's email at last sync — never a live join. */
    email: text("email").notNull(),
    /** JSON: CartLine[] — identifiers and quantities only, same rule as order items. */
    lines: text("lines").notNull().default("[]"),
    currency: text("currency").notNull(),
    /** Hash only; single-use. Cleared on redemption. */
    recoveryTokenHash: text("recovery_token_hash"),
    reminderSentAt: integer("reminder_sent_at"),
    recoveredAt: integer("recovered_at"),
    ...timestamps,
  },
  (t) => [
    index("carts_customer_idx").on(t.customerId),
    index("carts_updated_idx").on(t.updatedAt),
  ],
);

/**
 * Outbound webhook endpoints — see docs/tasks/14-outbound-webhooks.md.
 *
 * `secret` is stored in the clear, and that is deliberate rather than an
 * oversight. The brief sketched storing a hash, which works for the invite and
 * password-reset tokens elsewhere in this codebase because those are *verified*
 * — we compare a hash to a hash. An HMAC signing key has to be *used*: signing
 * with a hash of the secret would mean the merchant's Stripe-shaped
 * verification code, which HMACs the secret they were shown, never matches.
 * So it is a symmetric key held the same way `STRIPE_WEBHOOK_SECRET` is, and
 * what "shown once" buys is that no API response ever returns it again.
 */
export const webhookEndpoints = sqliteTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    description: text("description").notNull().default(""),
    /** Signing key. Never leaves the server after the response that mints it. */
    secret: text("secret").notNull(),
    /** JSON: WebhookEventType[]. */
    eventTypes: text("event_types").notNull().default("[]"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** Counts *exhausted deliveries*, not attempts. Any success resets it to zero. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    /** Set when the run of failures crossed the cap and we stopped retrying. */
    disabledAt: integer("disabled_at"),
    lastSuccessAt: integer("last_success_at"),
    lastErrorAt: integer("last_error_at"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [index("webhook_endpoints_enabled_idx").on(t.enabled)],
);

/**
 * One row per (event, endpoint) pair — the queue that makes delivery
 * out-of-band.
 *
 * Nothing is ever sent from a request handler: `emitWebhookEvent` inserts here
 * and returns, and the dispatcher in server/webhooks.ts picks it up. That is
 * what stops a slow merchant endpoint from delaying our response to Stripe,
 * which would trigger Stripe's own retry and re-enter the handler.
 *
 * State is read off the two timestamps: both null means still owed,
 * `deliveredAt` means done, `failedAt` means retries exhausted.
 */
export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    /** Sent in a header so a consumer can dedup exactly as we dedup Stripe's. */
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    /** JSON: the exact bytes that get signed. Snapshotted, never re-derived. */
    payload: text("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    /** Doubles as the lease: claiming pushes it out so a second instance skips. */
    nextAttemptAt: integer("next_attempt_at")
      .notNull()
      .default(sql`(unixepoch())`),
    responseStatus: integer("response_status"),
    error: text("error"),
    deliveredAt: integer("delivered_at"),
    failedAt: integer("failed_at"),
    ...timestamps,
  },
  (t) => [
    index("webhook_deliveries_endpoint_idx").on(t.endpointId),
    index("webhook_deliveries_due_idx").on(t.nextAttemptAt),
  ],
);
