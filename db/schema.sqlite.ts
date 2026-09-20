import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * SQLite schema. `db/schema.pg.ts` mirrors it for Postgres.
 *
 * Yes I Want A Postcard is a subscription platform: an artist queues one
 * postcard a month, subscribers pay a monthly price, and on the mailing day
 * every active subscriber is written one physical card that the print sweep
 * sends to Lob. The money runs the other way through `payouts`: each sent
 * card earns its artist the subscriber's price less the print cost and the
 * platform's fee, transferred through Stripe Connect.
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

/** Single row (id = 1). Platform-wide settings. */
export const storeSettings = sqliteTable("store_settings", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull().default("Yes I Want A Postcard"),
  currency: text("currency").notNull().default("USD"),
  /** BCP 47. Decides how money and dates are written — see `formatMoney`. */
  locale: text("locale").notNull().default("en-US"),
  /** Publishable key only — the secret key lives in the environment. */
  stripePublishableKey: text("stripe_publishable_key"),
  /**
   * What one printed and mailed card costs the platform, in cents. Read by
   * the payout ledger the moment Lob accepts a card, never recomputed later.
   */
  printCostCents: integer("print_cost_cents").notNull().default(120),
  /** What the platform keeps per sent card, in cents. */
  platformFeeCents: integer("platform_fee_cents").notNull().default(60),
  /** The least an artist may charge a month. Below it a card loses money. */
  minMonthlyPriceCents: integer("min_monthly_price_cents").notNull().default(300),
  /** The platform's US address, JSON in the recipient shape. Lob prints it as the return address. */
  returnAddress: text("return_address"),
  themeColorPrimary: text("theme_color_primary").notNull().default("#1c1917"),
  themeColorAccent: text("theme_color_accent").notNull().default("#f5c542"),
  themeFontFamily: text("theme_font_family").notNull().default("Quicksand, system-ui, sans-serif"),
  /**
   * Stylesheet defining the faces named in `theme_font_family`. Null means a
   * system font — and, because its origin is what widens the CSP, null also
   * means the site's security headers are unchanged. See server/fonts.ts.
   */
  themeFontUrl: text("theme_font_url"),
  themeBorderRadius: integer("theme_border_radius").notNull().default(4),
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
 * Everyone who signs in on the site — subscribers and artists alike.
 *
 * Distinct from `admin_users`: a customer session sets
 * `req.session.customerId`, a different flag from `adminId`, so `requireAdmin`
 * refuses it exactly as it would an anonymous caller. An artist is a customer
 * with a row in `artists` pointing back here.
 */
export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  /** argon2id, via the same path as admin_users. */
  passwordHash: text("password_hash"),
  name: text("name"),
  /** Set once the emailed link is used. */
  emailVerifiedAt: integer("email_verified_at"),
  /** Hash only; the raw token lives in the emailed link. Single-use. */
  emailVerifyTokenHash: text("email_verify_token_hash"),
  emailVerifyExpiresAt: integer("email_verify_expires_at"),
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: integer("password_reset_expires_at"),
  lastLoginAt: integer("last_login_at"),
  /** Where this person's postcards are mailed. JSON in the recipient shape; null until set. */
  address: text("address"),
  /** Stripe's Customer, made at the first checkout and reused for every later subscription. */
  stripeCustomerId: text("stripe_customer_id"),
  ...timestamps,
});

/**
 * An artist: a customer with a page under `/a/:slug`, a monthly price, and
 * a queue of cards.
 *
 * The Stripe Connect account is where their share of each subscription is
 * transferred. `payoutsEnabled` mirrors Stripe's own flag and is refreshed
 * from the `account.updated` webhook and the studio's own "check" button;
 * until it is true the ledger accrues and nothing is transferred.
 */
export const artists = sqliteTable(
  "artists",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    /** Markdown. Rendered to HTML at read time, never stored as HTML. */
    bio: text("bio").notNull().default(""),
    avatarPath: text("avatar_path"),
    avatarWidth: integer("avatar_width"),
    avatarHeight: integer("avatar_height"),
    avatarAlt: text("avatar_alt"),
    monthlyPriceCents: integer("monthly_price_cents").notNull(),
    /** The day of the month the queue advances, 1–28. */
    sendDay: integer("send_day").notNull().default(15),
    /** draft | live | paused */
    status: text("status").notNull().default("draft"),
    stripeAccountId: text("stripe_account_id"),
    payoutsEnabled: integer("payouts_enabled", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("artists_slug_idx").on(t.slug),
    uniqueIndex("artists_customer_idx").on(t.customerId),
    index("artists_status_idx").on(t.status),
  ],
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
    /** Show a link in the site banner. */
    inNav: integer("in_nav", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("pages_slug_idx").on(t.slug), index("pages_live_idx").on(t.isLive)],
);

/**
 * A postcard design: one front image and one back message, made by an
 * artist in their studio.
 *
 * The print file is written at Lob's exact size on upload, so nothing is
 * re-rendered at send time and a bad image fails while the artist is still
 * looking at it. A design that has been mailed keeps its files: the gallery
 * and every subscriber's account show the thumbnail, and the print file is
 * what a retry sends.
 */
export const postcardDesigns = sqliteTable(
  "postcard_designs",
  {
    id: text("id").primaryKey(),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    /** "portrait" | "landscape" */
    orientation: text("orientation").notNull(),
    /** Relative to the assets root — the file Lob prints. */
    printPath: text("print_path").notNull(),
    /** Relative to the assets root — what the site shows. */
    thumbnailPath: text("thumbnail_path").notNull(),
    thumbnailWidth: integer("thumbnail_width").notNull(),
    thumbnailHeight: integer("thumbnail_height").notNull(),
    /** JSON: PostcardBack — the message, valediction, font, size and colour. */
    back: text("back").notNull().default("{}"),
    ...timestamps,
  },
  (t) => [index("postcard_designs_artist_idx").on(t.artistId), index("postcard_designs_created_idx").on(t.createdAt)],
);

/**
 * A subscription: one person, one artist, one address, one monthly price.
 *
 * `priceCents` is a snapshot of the artist's price at the time — Stripe bills
 * it, and the payout ledger reads it — so an artist raising their price later
 * does not change what an existing subscriber pays or earns them.
 *
 *   incomplete  Checkout begun; the webhook has not confirmed payment
 *   active      paid up; gets every mailing
 *   past_due    a renewal failed; no cards until it clears
 *   cancelled   over
 */
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("incomplete"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    currentPeriodEnd: integer("current_period_end"),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
    /** JSON in the recipient shape: where every card under this subscription is mailed. */
    address: text("address").notNull(),
    cancelledAt: integer("cancelled_at"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("subscriptions_checkout_session_idx").on(t.stripeCheckoutSessionId),
    uniqueIndex("subscriptions_stripe_idx").on(t.stripeSubscriptionId),
    index("subscriptions_customer_idx").on(t.customerId),
    index("subscriptions_artist_status_idx").on(t.artistId, t.status),
  ],
);

/**
 * One card going to every subscriber on one day.
 *
 * `period` is the mailing's `YYYY-MM`, and the unique index on it with the
 * artist is what enforces one mailing a month: a subscriber pays once a
 * month, and each card earns the artist a month's share, so a second card
 * in the same month would be paid for by nobody.
 *
 *   queued     waiting for `mailDate`
 *   mailed     one `postcards` row per active subscriber has been written
 *   cancelled  withdrawn before the date
 */
export const mailings = sqliteTable(
  "mailings",
  {
    id: text("id").primaryKey(),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    designId: text("design_id")
      .notNull()
      .references(() => postcardDesigns.id),
    title: text("title"),
    /** ISO date, YYYY-MM-DD, in the platform's day. */
    mailDate: text("mail_date").notNull(),
    period: text("period").notNull(),
    status: text("status").notNull().default("queued"),
    inGallery: integer("in_gallery", { mode: "boolean" }).notNull().default(true),
    /** How many subscribers were written cards when it went. */
    subscriberCount: integer("subscriber_count").notNull().default(0),
    mailedAt: integer("mailed_at"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("mailings_artist_period_idx").on(t.artistId, t.period),
    index("mailings_due_idx").on(t.status, t.mailDate),
    index("mailings_artist_idx").on(t.artistId, t.mailDate),
  ],
);

/**
 * One physical postcard: a mailing's design, going to one subscriber.
 *
 * This is the unit Lob deals in and the unit a subscriber follows, so it is
 * the unit the database keeps. The address is copied onto the row when the
 * mailing goes, so a subscriber who moves later does not change what was
 * sent.
 *
 * `status`:
 *   scheduled  waiting for the print sweep
 *   sending    claimed by the sweep — a second instance skips it
 *   sent       accepted by Lob; `lobId` is theirs
 *   error      Lob refused it; `lastError` says why, in Lob's own words
 *   cancelled  withdrawn before it went out
 */
export const postcards = sqliteTable(
  "postcards",
  {
    id: text("id").primaryKey(),
    mailingId: text("mailing_id")
      .notNull()
      .references(() => mailings.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    designId: text("design_id")
      .notNull()
      .references(() => postcardDesigns.id),
    recipientName: text("recipient_name").notNull(),
    recipientLine1: text("recipient_line1").notNull(),
    recipientLine2: text("recipient_line2"),
    recipientCity: text("recipient_city").notNull(),
    recipientState: text("recipient_state").notNull(),
    recipientPostalCode: text("recipient_postal_code").notNull(),
    /** ISO 3166-1 alpha-2, what Lob's `address_country` takes. */
    recipientCountry: text("recipient_country").notNull().default("US"),
    /** ISO date, YYYY-MM-DD — the day it goes to Lob. */
    mailDate: text("mail_date").notNull(),
    status: text("status").notNull().default("scheduled"),
    lobId: text("lob_id"),
    /** Lob's rendered proof, when they return one. */
    lobUrl: text("lob_url"),
    /** Expected delivery, from Lob, as an ISO date. */
    expectedDeliveryDate: text("expected_delivery_date"),
    sentAt: integer("sent_at"),
    /** How many times the sweep has tried. A transient failure retries; a refusal does not. */
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** The latest tracking event Lob reported, as its `event_type.id`. Denormalised from the events table. */
    trackingStatus: text("tracking_status"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("postcards_mailing_subscription_idx").on(t.mailingId, t.subscriptionId),
    index("postcards_subscription_idx").on(t.subscriptionId),
    index("postcards_artist_idx").on(t.artistId),
    index("postcards_due_idx").on(t.status, t.mailDate),
    index("postcards_lob_idx").on(t.lobId),
  ],
);

/**
 * Where a card is, from Lob's tracking webhook: one row per event, keyed
 * by Lob's event id so a redelivery is a no-op. Shown as a timeline on the
 * subscriber's postcards page; never emailed.
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
 * A postcard order: one paid Stripe invoice under a subscription. What the
 * subscriber's receipts list, and what the admin reconciles a month's
 * payouts against. Written by the `invoice.paid` webhook and nothing else.
 */
export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    stripeInvoiceId: text("stripe_invoice_id").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    /** paid | refunded */
    status: text("status").notNull().default("paid"),
    amountCents: integer("amount_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    currency: text("currency").notNull(),
    periodStart: integer("period_start"),
    periodEnd: integer("period_end"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_invoice_idx").on(t.stripeInvoiceId),
    index("orders_subscription_idx").on(t.subscriptionId),
    index("orders_customer_idx").on(t.customerId),
    index("orders_artist_idx").on(t.artistId),
    index("orders_created_idx").on(t.createdAt),
  ],
);

/**
 * What one sent card earned its artist: the ledger the payout sweep works
 * through. Written the moment Lob accepts a card, with the subscriber's
 * price and the platform's numbers as they were that moment, so a later
 * change to either never rewrites history.
 *
 *   pending  waiting for the artist's Stripe account, or the next sweep
 *   paid     transferred; `stripeTransferId` is Stripe's
 *   failed   Stripe refused the transfer; `lastError` says why
 */
export const payouts = sqliteTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    postcardId: text("postcard_id")
      .notNull()
      .references(() => postcards.id, { onDelete: "cascade" }),
    mailingId: text("mailing_id").notNull(),
    grossCents: integer("gross_cents").notNull(),
    printCostCents: integer("print_cost_cents").notNull(),
    platformFeeCents: integer("platform_fee_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("pending"),
    stripeTransferId: text("stripe_transfer_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    paidAt: integer("paid_at"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payouts_postcard_idx").on(t.postcardId),
    index("payouts_artist_status_idx").on(t.artistId, t.status),
    index("payouts_status_idx").on(t.status),
  ],
);

/**
 * Stripe and Lob deliver webhooks at least once. Recording event ids makes
 * replay a no-op instead of a duplicate order or a duplicate scan.
 */
export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: integer("received_at")
    .notNull()
    .default(sql`(unixepoch())`),
});
