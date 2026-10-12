import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * SQLite schema. `db/schema.pg.ts` mirrors it for Postgres.
 *
 * Yes I Want A Postcard sells editions: an artist makes a set of 6 or 12
 * postcards, sent monthly or twice a month, at one price. A collector pays
 * for the whole set up front, and the moment Stripe confirms it every card
 * of their run is written as a `postcards` row with its own mail date, which
 * the print sweep sends to Lob when the day comes. The money runs the other
 * way through `payouts`: each sent card earns its artist one card's share of
 * the price, less the print cost and the platform's fee, transferred through
 * Stripe Connect.
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
  /** The least an edition may charge per card. Below it a card loses money. */
  minCardPriceCents: integer("min_card_price_cents").notNull().default(300),
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
 * Everyone who signs in on the site — collectors and artists alike.
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
  /** Stripe's Customer, made at the first checkout and reused for every later one. */
  stripeCustomerId: text("stripe_customer_id"),
  ...timestamps,
});

/**
 * An artist: a customer with a page under `/artist/:slug` and the editions
 * they sell from it.
 *
 * The Stripe Connect account is where their share of each sent card is
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
    /** A wide picture across the top of the page. */
    bannerPath: text("banner_path"),
    bannerWidth: integer("banner_width"),
    bannerHeight: integer("banner_height"),
    bannerAlt: text("banner_alt"),
    /** JSON: ArtistLink[] — a website, a shop, social accounts. */
    links: text("links").notNull().default("[]"),
    /** draft | live | paused */
    status: text("status").notNull().default("draft"),
    /** public | private. Private keeps the artist's editions out of the shared gallery. */
    visibility: text("visibility").notNull().default("public"),
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
 * looking at it. A design that has been mailed keeps its files: every
 * collector's account shows the thumbnail, and the print file is what a
 * retry sends.
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
 * An edition: a set of 6 or 12 cards, sent monthly or twice a month, at one
 * price for the whole set.
 *
 * The cards are a surprise: visitors see the banner and the description —
 * the artist's writeup of what will arrive — and each card only once it is
 * in their letterbox.
 *
 * Built as a `draft`; once `on_sale` its cards, size and price are
 * fixed — a collector paid for exactly these — and only its words can
 * change. `closed` stops new collectors; everyone who already paid still
 * gets every card. The slug is unique per artist: `/artist/:slug/:edition`.
 *
 *   draft     being made; only its artist sees it
 *   on_sale   listed, collectable
 *   closed    no new collectors; existing runs carry on
 */
export const editions = sqliteTable(
  "editions",
  {
    id: text("id").primaryKey(),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** Markdown: what collectors will get. Rendered to HTML at read time, never stored as HTML. */
    description: text("description").notNull().default(""),
    /** A wide picture across the top of the edition's page, standing in for the cards. */
    bannerPath: text("banner_path"),
    bannerWidth: integer("banner_width"),
    bannerHeight: integer("banner_height"),
    bannerAlt: text("banner_alt"),
    /** 6 or 12. */
    cardCount: integer("card_count").notNull(),
    /** For the whole set, not per card. */
    priceCents: integer("price_cents").notNull(),
    status: text("status").notNull().default("draft"),
    /** Whether it appears in the shared gallery while on sale. */
    inGallery: integer("in_gallery", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("editions_artist_slug_idx").on(t.artistId, t.slug), index("editions_status_idx").on(t.status)],
);

/**
 * One card of an edition, in its place in the set. `firstMailedAt` is set
 * the first time any collector's copy of it is accepted by Lob.

 */
export const editionCards = sqliteTable(
  "edition_cards",
  {
    id: text("id").primaryKey(),
    editionId: text("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    designId: text("design_id")
      .notNull()
      .references(() => postcardDesigns.id),
    /** 1-based. Card 1 is the edition's cover. */
    position: integer("position").notNull(),
    title: text("title"),
    firstMailedAt: integer("first_mailed_at"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("edition_cards_position_idx").on(t.editionId, t.position),
    index("edition_cards_design_idx").on(t.designId),
    index("edition_cards_mailed_idx").on(t.firstMailedAt),
  ],
);

/**
 * A purchase: one person collecting one edition, paid once, up front.
 *
 * The price and size are snapshots of the edition at checkout; the cadence
 * and the start date are the collector's: the first card goes that day and
 * the rest follow as often as they asked. When Stripe confirms payment the webhook
 * writes every card of the run as a `postcards` row.
 *
 *   incomplete  Checkout begun; the webhook has not confirmed payment
 *   paid        confirmed; its cards are scheduled
 *   refunded    refunded in full; its unsent cards were cancelled
 */
export const purchases = sqliteTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    editionId: text("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("incomplete"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    priceCents: integer("price_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    cardCount: integer("card_count").notNull(),
    /** monthly | twice_monthly: the collector's choice. */
    cadence: text("cadence").notNull(),
    /** ISO date, YYYY-MM-DD: the first card's day. Its day of the month sets the rest. */
    startDate: text("start_date").notNull(),
    /** JSON in the recipient shape: where the cards go. Copied onto each card as it is written. */
    address: text("address").notNull(),
    paidAt: integer("paid_at"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("purchases_checkout_session_idx").on(t.stripeCheckoutSessionId),
    index("purchases_payment_intent_idx").on(t.stripePaymentIntentId),
    index("purchases_customer_idx").on(t.customerId),
    index("purchases_edition_status_idx").on(t.editionId, t.status),
    index("purchases_artist_status_idx").on(t.artistId, t.status),
  ],
);

/**
 * One physical postcard: one card of an edition, going to one collector on
 * one day.
 *
 * This is the unit Lob deals in and the unit a collector follows, so it is
 * the unit the database keeps. Every card of a run is written when the
 * purchase is paid; the address is copied on then, and a collector who moves
 * updates the cards still to come, never one that has gone.
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
    purchaseId: text("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    editionId: text("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    editionCardId: text("edition_card_id")
      .notNull()
      .references(() => editionCards.id),
    /** Which card of the set, 1-based. Its share of the price is computed from it. */
    position: integer("position").notNull(),
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
    uniqueIndex("postcards_purchase_position_idx").on(t.purchaseId, t.position),
    index("postcards_edition_card_idx").on(t.editionCardId),
    index("postcards_artist_idx").on(t.artistId),
    index("postcards_due_idx").on(t.status, t.mailDate),
    index("postcards_lob_idx").on(t.lobId),
  ],
);

/**
 * Where a card is, from Lob's tracking webhook: one row per event, keyed
 * by Lob's event id so a redelivery is a no-op. Shown as a timeline on the
 * collector's postcards page; never emailed.
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
 * What one sent card earned its artist: the ledger the payout sweep works
 * through. Written the moment Lob accepts a card, with that card's share of
 * the purchase price and the platform's numbers as they were that moment, so
 * a later change to either never rewrites history.
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
    purchaseId: text("purchase_id").notNull(),
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
