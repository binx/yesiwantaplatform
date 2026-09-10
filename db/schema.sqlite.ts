import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * SQLite schema. `db/schema.pg.ts` mirrors it for Postgres.
 *
 * Postcards v2 is a fork of Beluga v2 cut down to one product: a postcard,
 * designed by the buyer, printed and mailed by Lob on a date they choose.
 * There is no catalogue — the price lives on `store_settings` — and there is
 * no shipping address on an order: every postcard row carries its own
 * recipient, because that *is* what is being bought.
 *
 * Two rules run through the whole thing, inherited from Beluga:
 *   - Money is an INTEGER number of cents. Never a float, never a REAL column.
 *   - Stripe is the authority on payment; everything about fulfilment is ours.
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
  name: text("name").notNull().default("Postcard Gifts"),
  currency: text("currency").notNull().default("USD"),
  /** BCP 47. Decides how money and dates are written — see `formatMoney`. */
  locale: text("locale").notNull().default("en-US"),
  /** Publishable key only — the secret key lives in the environment. */
  stripePublishableKey: text("stripe_publishable_key"),
  /**
   * What one postcard costs, in cents. The whole "catalogue".
   *
   * Read by checkout on every order rather than sent by the client — the same
   * rule Beluga's variants held to, applied to the one price this store has.
   * Charged through Stripe's inline `price_data`, so changing it here is
   * enough: there is no Stripe Price to republish.
   */
  postcardPriceCents: integer("postcard_price_cents").notNull().default(140),
  /** The price of a card mailed abroad. Null means the shop is US-only. */
  internationalPostcardPriceCents: integer("international_postcard_price_cents"),
  /** The shop's US address, JSON in the recipient shape. Lob prints it as the return address on international mail. */
  returnAddress: text("return_address"),
  /**
   * Abandoned cart reminders. Off by default — the merchant must opt in, and
   * the email goes out under their own SMTP sending reputation.
   */
  cartRecoveryEnabled: integer("cart_recovery_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Hours of inactivity before the one reminder goes out. */
  cartRecoveryDelayHours: integer("cart_recovery_delay_hours").notNull().default(4),
  themeColorPrimary: text("theme_color_primary").notNull().default("#333333"),
  themeColorAccent: text("theme_color_accent").notNull().default("#ffff37"),
  themeFontFamily: text("theme_font_family").notNull().default("Quicksand, system-ui, sans-serif"),
  /**
   * Stylesheet defining the faces named in `theme_font_family`. Null means a
   * system font — and, because its origin is what widens the CSP, null also
   * means the store's security headers are unchanged. See server/fonts.ts.
   */
  themeFontUrl: text("theme_font_url"),
  themeBorderRadius: integer("theme_border_radius").notNull().default(2),
  themeColorScheme: text("theme_color_scheme").notNull().default("light"),
  /** Null means "follow the scheme". */
  themeColorPage: text("theme_color_page"),
  themeLogoPath: text("theme_logo_path"),
  themeLogoWidth: integer("theme_logo_width"),
  themeLogoHeight: integer("theme_logo_height"),
  themeLogoAlt: text("theme_logo_alt"),
  /* The landing page's opening block. All nullable; every reader falls back. */
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
  /** argon2id. */
  passwordHash: text("password_hash").notNull(),
  lastLoginAt: integer("last_login_at"),
  /** Hash only, same reasoning as the customer tokens. */
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: integer("password_reset_expires_at"),
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
  /** argon2id, via the same path as admin_users. */
  passwordHash: text("password_hash"),
  name: text("name"),
  /**
   * Set once the emailed link is used. Orders are only ever linked to this
   * account after this is set — see `claimOrdersForCustomer` — so
   * registering with a stranger's address cannot read their order history.
   */
  emailVerifiedAt: integer("email_verified_at"),
  /** Hash only; the raw token lives in the emailed link. Single-use. */
  emailVerifyTokenHash: text("email_verify_token_hash"),
  emailVerifyExpiresAt: integer("email_verify_expires_at"),
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: integer("password_reset_expires_at"),
  lastLoginAt: integer("last_login_at"),
  /** Set once this customer clicks "unsubscribe" on a cart reminder. */
  cartRecoveryOptOutAt: integer("cart_recovery_opt_out_at"),
  /** Hash only. Minted fresh on every reminder send. */
  cartRecoveryUnsubscribeTokenHash: text("cart_recovery_unsubscribe_token_hash"),
  ...timestamps,
});

/**
 * A customer's saved recipients — the people they send postcards to.
 *
 * Beluga called this the address book and used it to prefill the *buyer's*
 * shipping address. Here nothing ships to the buyer: every address is someone
 * else's, and the point of saving one is to pick it again next time.
 */
export const customerAddresses = sqliteTable(
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
    /** ISO 3166-1 alpha-2. */
    country: text("country").notNull().default("US"),
    /** When Lob's verification last called this address deliverable. Null: never, or edited since. */
    verifiedAt: integer("verified_at"),
    /** What the customer calls them — "Mom", "the Okafors". The card still prints `name`. */
    label: text("label"),
    /** Free tags for grouping, lowercase, as a JSON array in TEXT. */
    tags: text("tags").notNull().default("[]"),
    /** MM-DD, or YYYY-MM-DD when the year is known. */
    birthday: text("birthday"),
    notes: text("notes"),
    /** How this entry arrived: a paid order, typed by hand, or a request link. */
    source: text("source").notNull().default("order"),
    /** The most recent paid order that mailed to this address. */
    lastSentAt: integer("last_sent_at"),
    /** The request link this entry came through, when it did. */
    requestId: text("request_id"),
    ...timestamps,
  },
  (t) => [index("customer_addresses_customer_idx").on(t.customerId)],
);

/**
 * "Send me your address" links.
 *
 * The token is stored in the clear — the one token-shaped thing here that
 * is not hashed, on purpose. A collector link is re-copied for weeks, and
 * what it unlocks is submitting one address into someone's book and reading
 * their first name; a leaked database makes nothing of that worse. Do not
 * "fix" it to a hash without a way to show the link again.
 */
export const addressRequests = sqliteTable(
  "address_requests",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** 32 random bytes, base64url. */
    token: text("token").notNull(),
    /** "Maya", or "Holiday card 2026". Shown to the requester; to the responder only for a collector. */
    label: text("label").notNull(),
    /** A collector takes many responses; a single link takes one. */
    multi: integer("multi", { mode: "boolean" }).notNull().default(false),
    /** open | fulfilled | revoked. Expiry is `expiresAt`, read at request time. */
    status: text("status").notNull().default("open"),
    notifyByEmail: integer("notify_by_email", { mode: "boolean" }).notNull().default(true),
    responses: integer("responses").notNull().default(0),
    expiresAt: integer("expires_at").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("address_requests_token_idx").on(t.token), index("address_requests_customer_idx").on(t.customerId)],
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

/**
 * Editable prose pages — about, FAQ, contact, privacy.
 *
 * Bodies are Markdown and are rendered to HTML at read time; nothing here is
 * ever stored as HTML, so a change to the sanitiser applies retroactively.
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

/**
 * A postcard design: one front image and one back message.
 *
 * Created the moment a buyer saves a design, before there is any order — the
 * image has to live somewhere while they add recipients and pick dates. The
 * print file is written at Lob's exact size on upload, so nothing is
 * re-rendered at send time and a bad image fails while the buyer is still
 * looking at it.
 *
 * `orderId` is set by the payment webhook. A design that never reaches a paid
 * order is swept away after a month — see server/fulfilment.ts — which is the
 * only cleanup a public upload route needs to stay honest.
 */
export const postcardDesigns = sqliteTable(
  "postcard_designs",
  {
    id: text("id").primaryKey(),
    /** Set when a signed-in customer designed it. Null for a guest. */
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Set once a paid order holds postcards of this design. */
    orderId: text("order_id"),
    /** "portrait" | "landscape" */
    orientation: text("orientation").notNull(),
    /** Relative to the assets root — the file Lob prints. Null once cleaned up. */
    printPath: text("print_path"),
    /** Relative to the assets root — what the storefront shows. */
    thumbnailPath: text("thumbnail_path").notNull(),
    thumbnailWidth: integer("thumbnail_width").notNull(),
    thumbnailHeight: integer("thumbnail_height").notNull(),
    /** JSON: PostcardBack — the message, valediction, font, size and colour. */
    back: text("back").notNull().default("{}"),
    ...timestamps,
  },
  (t) => [
    index("postcard_designs_customer_idx").on(t.customerId),
    index("postcard_designs_order_idx").on(t.orderId),
    index("postcard_designs_created_idx").on(t.createdAt),
  ],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    email: text("email").notNull(),
    /** Nullable: guest checkout is the default and stays supported. */
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** pending | paid | completed | cancelled | refunded */
    status: text("status").notNull().default("pending"),
    currency: text("currency").notNull().default("USD"),
    /** What one postcard cost when this order was placed — a snapshot. */
    unitPriceCents: integer("unit_price_cents").notNull(),
    /** How many postcards: every design × every recipient, summed over batches. */
    postcardCount: integer("postcard_count").notNull(),
    /** How many of those went abroad, and the price each of them was charged at. */
    internationalCount: integer("international_count").notNull().default(0),
    internationalUnitPriceCents: integer("international_unit_price_cents"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    /** Total discount applied at Stripe. Zero when no code was used. */
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    /** Cumulative amount refunded. Less than totalCents means a partial refund. */
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

/**
 * One physical postcard: a design, a recipient, and a day to mail it.
 *
 * This is the unit Lob deals in and the unit the buyer follows, so it is the
 * unit the database keeps. `batchIndex` remembers which cart line it came
 * from, which is what lets an expired checkout rebuild the exact cart for a
 * reminder email.
 *
 * `status`:
 *   pending    the order has not been paid yet
 *   scheduled  paid; waiting for `mailDate`
 *   sending    claimed by the sweep — a second instance skips it
 *   sent       accepted by Lob; `lobId` is theirs
 *   error      Lob refused it; `lastError` says why, in Lob's own words
 *   cancelled  the order was cancelled or refunded before it went out
 */
export const postcards = sqliteTable(
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
    /** ISO date, YYYY-MM-DD, in the store's day — the day it goes to Lob. */
    mailDate: text("mail_date").notNull(),
    status: text("status").notNull().default("pending"),
    lobId: text("lob_id"),
    /** Lob's rendered proof, when they return one. */
    lobUrl: text("lob_url"),
    /** Expected delivery, from Lob, as an ISO date. */
    expectedDeliveryDate: text("expected_delivery_date"),
    sentAt: integer("sent_at"),
    /** How many times the sweep has tried. A transient failure retries; a refusal does not. */
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** The latest tracking event Lob reported, as its `event_type.id` — `postcard.in_transit`. Denormalised from the events table. */
    trackingStatus: text("tracking_status"),
    ...timestamps,
  },
  (t) => [
    index("postcards_order_idx").on(t.orderId),
    index("postcards_design_idx").on(t.designId),
    index("postcards_due_idx").on(t.status, t.mailDate),
  ],
);

/**
 * Where a card is, from Lob's tracking webhook: one row per event, keyed
 * by Lob's event id so a redelivery is a no-op. Shown as a timeline on the
 * order pages; never emailed.
 */
export const postcardTrackingEvents = sqliteTable(
  "postcard_tracking_events",
  {
    /** Lob's event id, `evt_…`. */
    id: text("id").primaryKey(),
    postcardId: text("postcard_id")
      .notNull()
      .references(() => postcards.id, { onDelete: "cascade" }),
    /** Lob's `event_type.id`, verbatim. */
    type: text("type").notNull(),
    /** When it happened, unix seconds. */
    occurredAt: integer("occurred_at").notNull(),
    /** The scan's location, when Lob includes one. */
    location: text("location"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("postcard_tracking_postcard_idx").on(t.postcardId, t.occurredAt)],
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
 * remind them about. Only ever populated for a customer with an account.
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
    /** JSON: CartLine[] — design ids, dates and recipients. */
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
