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
 * The repository normalises both to the same domain objects. The comments
 * live on the SQLite file; read that one.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const storeSettings = pgTable("store_settings", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull().default("Yes I Want A Postcard"),
  currency: text("currency").notNull().default("USD"),
  locale: text("locale").notNull().default("en-US"),
  stripePublishableKey: text("stripe_publishable_key"),
  printCostCents: integer("print_cost_cents").notNull().default(120),
  platformFeeCents: integer("platform_fee_cents").notNull().default(60),
  minMonthlyPriceCents: integer("min_monthly_price_cents").notNull().default(300),
  returnAddress: jsonb("return_address"),
  themeColorPrimary: text("theme_color_primary").notNull().default("#1c1917"),
  themeColorAccent: text("theme_color_accent").notNull().default("#f5c542"),
  themeFontFamily: text("theme_font_family").notNull().default("Quicksand, system-ui, sans-serif"),
  themeFontUrl: text("theme_font_url"),
  themeBorderRadius: integer("theme_border_radius").notNull().default(4),
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
  address: jsonb("address"),
  stripeCustomerId: text("stripe_customer_id"),
  ...timestamps,
});

export const artists = pgTable(
  "artists",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    bio: text("bio").notNull().default(""),
    avatarPath: text("avatar_path"),
    avatarWidth: integer("avatar_width"),
    avatarHeight: integer("avatar_height"),
    avatarAlt: text("avatar_alt"),
    bannerPath: text("banner_path"),
    bannerWidth: integer("banner_width"),
    bannerHeight: integer("banner_height"),
    bannerAlt: text("banner_alt"),
    /** ArtistLink[] — a website, a shop, social accounts. */
    links: jsonb("links").notNull().default(sql`'[]'::jsonb`),
    monthlyPriceCents: integer("monthly_price_cents").notNull(),
    /** How many monthly payments a subscription runs for before it ends. */
    termMonths: integer("term_months").notNull().default(6),
    sendDay: integer("send_day").notNull().default(15),
    status: text("status").notNull().default("draft"),
    visibility: text("visibility").notNull().default("public"),
    stripeAccountId: text("stripe_account_id"),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("artists_slug_idx").on(t.slug),
    uniqueIndex("artists_customer_idx").on(t.customerId),
    index("artists_status_idx").on(t.status),
  ],
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
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    orientation: text("orientation").notNull(),
    printPath: text("print_path").notNull(),
    thumbnailPath: text("thumbnail_path").notNull(),
    thumbnailWidth: integer("thumbnail_width").notNull(),
    thumbnailHeight: integer("thumbnail_height").notNull(),
    back: jsonb("back").notNull().default({}),
    ...timestamps,
  },
  (t) => [index("postcard_designs_artist_idx").on(t.artistId), index("postcard_designs_created_idx").on(t.createdAt)],
);

export const subscriptions = pgTable(
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
    /** How many monthly payments it runs for — the artist's term when it was taken out. */
    termMonths: integer("term_months").notNull().default(6),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    address: jsonb("address").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("subscriptions_checkout_session_idx").on(t.stripeCheckoutSessionId),
    uniqueIndex("subscriptions_stripe_idx").on(t.stripeSubscriptionId),
    index("subscriptions_customer_idx").on(t.customerId),
    index("subscriptions_artist_status_idx").on(t.artistId, t.status),
  ],
);

export const mailings = pgTable(
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
    mailDate: text("mail_date").notNull(),
    period: text("period").notNull(),
    status: text("status").notNull().default("queued"),
    inGallery: boolean("in_gallery").notNull().default(true),
    subscriberCount: integer("subscriber_count").notNull().default(0),
    mailedAt: timestamp("mailed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("mailings_artist_period_idx").on(t.artistId, t.period),
    index("mailings_due_idx").on(t.status, t.mailDate),
    index("mailings_artist_idx").on(t.artistId, t.mailDate),
  ],
);

export const postcards = pgTable(
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
    recipientCountry: text("recipient_country").notNull().default("US"),
    mailDate: text("mail_date").notNull(),
    status: text("status").notNull().default("scheduled"),
    lobId: text("lob_id"),
    lobUrl: text("lob_url"),
    expectedDeliveryDate: text("expected_delivery_date"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
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

export const orders = pgTable(
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
    status: text("status").notNull().default("paid"),
    amountCents: integer("amount_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    currency: text("currency").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
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

export const payouts = pgTable(
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
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payouts_postcard_idx").on(t.postcardId),
    index("payouts_artist_status_idx").on(t.artistId, t.status),
    index("payouts_status_idx").on(t.status),
  ],
);

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
