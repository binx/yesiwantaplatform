import { z } from "zod";
import { centsSchema, imageSchema, slugSchema, RESERVED_PAGE_SLUGS } from "./schema.js";
import { mailDateSchema, postcardDesignSchema, postcardSchema, recipientSchema } from "./postcards.js";

/**
 * The platform's own nouns: artists, the subscriptions people take out with
 * them, the mailings an artist queues, and the payouts each sent card earns.
 *
 * Everything here is validated on both sides of the wire, and nothing here
 * carries a price the server would trust: an artist's monthly price is read
 * from their row at checkout, and every payout amount is computed on the
 * server from the subscription's own snapshot.
 */

/* ---------------------------------------------------------------- artists */

/** An artist's address under `/a/`. Three characters at least, so `/a/me` is not a thing. */
export const artistSlugSchema = slugSchema.min(3, "Use at least 3 characters.").max(40, "40 characters at most.").superRefine((value, ctx) => {
  const owner = RESERVED_PAGE_SLUGS[value];
  if (owner) ctx.addIssue({ code: "custom", message: `"${value}" is already ${owner}. Choose a different address.` });
});

/**
 * Where an artist is in the world, as the visitor sees it.
 *
 *   draft   the page is being written; only its owner can see it
 *   live    listed, subscribable
 *   paused  the artist stopped: no new subscribers, existing ones keep
 *           receiving queued cards until they cancel
 */
export const artistStatusSchema = z.enum(["draft", "live", "paused"]);
export type ArtistStatus = z.infer<typeof artistStatusSchema>;

/** The day of the month an artist's queue advances. 28 at most: every month has one. */
export const sendDaySchema = z.number().int().min(1).max(28);

/** An artist as any visitor may see them. Nothing about money beyond the price. */
export const artistPublicSchema = z.object({
  id: z.string(),
  slug: artistSlugSchema,
  name: z.string().min(1),
  /** One line under the name. */
  tagline: z.string().nullable().default(null),
  /** Sanitised HTML rendered from the artist's Markdown. */
  bioHtml: z.string().default(""),
  avatar: imageSchema.nullable().default(null),
  monthlyPriceCents: centsSchema,
  currency: z.string().length(3),
  status: artistStatusSchema,
  sendDay: sendDaySchema,
  subscriberCount: z.number().int().min(0),
  /** How many cards this artist has mailed to subscribers, all time. */
  mailedCount: z.number().int().min(0),
  createdAt: z.number().int(),
});

/** One artist in the directory: enough for a tile. */
export const artistSummarySchema = artistPublicSchema.pick({
  id: true,
  slug: true,
  name: true,
  tagline: true,
  avatar: true,
  monthlyPriceCents: true,
  currency: true,
  subscriberCount: true,
  mailedCount: true,
}).extend({
  /** The most recently mailed card, for the tile's picture. */
  latest: postcardDesignSchema.nullable().default(null),
});

export const artistProfileInputSchema = z.object({
  slug: artistSlugSchema,
  name: z.string().trim().min(1, "A name is required.").max(80, "80 characters at most."),
  tagline: z.string().trim().max(140, "140 characters at most.").nullable().default(null),
  /** Markdown. Rendered and sanitised on the way out, like a page. */
  bio: z.string().max(10_000).default(""),
  monthlyPriceCents: centsSchema.min(50, "Stripe cannot charge less than 50 cents."),
  sendDay: sendDaySchema.default(15),
  avatar: imageSchema.nullable().default(null),
});

/** What the artist's own studio shows them: the public profile, plus their Markdown and payout wiring. */
export const artistStudioSchema = artistPublicSchema.extend({
  bio: z.string(),
  /** Whether Stripe has finished onboarding this artist for payouts. */
  payoutsEnabled: z.boolean(),
  /** Whether the artist has begun Connect onboarding at all. */
  hasStripeAccount: z.boolean(),
  /** The customer account this artist signs in with. */
  email: z.string(),
});

export type ArtistPublic = z.infer<typeof artistPublicSchema>;
export type ArtistSummary = z.infer<typeof artistSummarySchema>;
export type ArtistProfileInput = z.infer<typeof artistProfileInputSchema>;
export type ArtistStudio = z.infer<typeof artistStudioSchema>;

/* ---------------------------------------------------------- subscriptions */

/**
 * A subscription's state, from Stripe's point of view and ours.
 *
 *   incomplete  Checkout was started; the webhook has not confirmed payment
 *   active      paid for the current period; gets every mailing that falls in it
 *   past_due    a renewal failed; Stripe is retrying. No cards go out
 *   cancelled   over, by the subscriber or by Stripe giving up
 */
export const subscriptionStatusSchema = z.enum(["incomplete", "active", "past_due", "cancelled"]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

/** A subscription as its holder sees it. */
export const subscriptionSchema = z.object({
  id: z.string(),
  artist: artistSummarySchema.pick({ id: true, slug: true, name: true, avatar: true }),
  status: subscriptionStatusSchema,
  /** What this subscriber pays a month — a snapshot; the artist may change theirs later. */
  priceCents: centsSchema,
  currency: z.string(),
  /** End of the paid period, epoch milliseconds. Null until the first invoice lands. */
  currentPeriodEnd: z.number().int().nullable(),
  /** Set when the subscriber asked to stop: cards keep coming until the period ends. */
  cancelAtPeriodEnd: z.boolean(),
  /** Where the cards are mailed. */
  address: recipientSchema,
  /** Cards mailed under this subscription, all time. */
  postcardCount: z.number().int().min(0),
  createdAt: z.number().int(),
  cancelledAt: z.number().int().nullable(),
});

/** Start a subscription: which artist, and where to mail. The price is never sent. */
export const subscribeInputSchema = z.object({
  artistId: z.string().min(1),
  address: recipientSchema,
});

export const subscribeResponseSchema = z.object({
  url: z.string().url(),
  subscriptionId: z.string(),
});

/** What the artist is told about a subscriber: a first name and a town, not an address. */
export const subscriberSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  country: z.string(),
  status: subscriptionStatusSchema,
  since: z.number().int(),
});

export type Subscription = z.infer<typeof subscriptionSchema>;
export type SubscribeInput = z.infer<typeof subscribeInputSchema>;
export type SubscribeResponse = z.infer<typeof subscribeResponseSchema>;
export type Subscriber = z.infer<typeof subscriberSchema>;

/* --------------------------------------------------------------- mailings */

/**
 * One card going to every subscriber on one day.
 *
 *   queued     waiting for its date
 *   mailed     its date came; one postcard row per subscriber was written
 *              and each is on its own way through the print sweep
 *   cancelled  withdrawn by the artist before the date
 */
export const mailingStatusSchema = z.enum(["queued", "mailed", "cancelled"]);
export type MailingStatus = z.infer<typeof mailingStatusSchema>;

export const mailingSchema = z.object({
  id: z.string(),
  artistId: z.string(),
  design: postcardDesignSchema,
  /** A line the gallery shows under the card. */
  title: z.string().nullable(),
  mailDate: mailDateSchema,
  /** `YYYY-MM`: one mailing per artist per month, enforced by the database. */
  period: z.string().regex(/^\d{4}-\d{2}$/),
  status: mailingStatusSchema,
  /** Whether the front appears in the public gallery once mailed. */
  inGallery: z.boolean(),
  /** How many subscribers were written cards when it went. */
  subscriberCount: z.number().int().min(0),
  /** Where those cards are, in one row. */
  postcards: z.object({
    scheduled: z.number().int(),
    sent: z.number().int(),
    error: z.number().int(),
    cancelled: z.number().int(),
  }),
  mailedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
});

export const mailingInputSchema = z.object({
  designId: z.string().min(1),
  mailDate: mailDateSchema,
  title: z.string().trim().max(120).nullable().default(null),
  inGallery: z.boolean().default(true),
});

export const mailingUpdateInputSchema = mailingInputSchema.omit({ designId: true });

export type Mailing = z.infer<typeof mailingSchema>;
export type MailingInput = z.infer<typeof mailingInputSchema>;
export type MailingUpdateInput = z.infer<typeof mailingUpdateInputSchema>;

/** `"2026-09-14"` → `"2026-09"`. */
export function periodOf(mailDate: string): string {
  return mailDate.slice(0, 7);
}

/**
 * The next date this artist's queue would naturally advance on: their send
 * day, in the first month not already taken. Pure calendar arithmetic.
 */
export function nextMailDate(sendDay: number, taken: readonly string[], today: string): string {
  const takenPeriods = new Set(taken.map(periodOf));
  const [year, month] = today.split("-").map(Number) as [number, number];
  const day = String(sendDay).padStart(2, "0");
  for (let offset = 0; offset < 36; offset += 1) {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    const period = date.toISOString().slice(0, 7);
    const candidate = `${period}-${day}`;
    if (candidate < today || takenPeriods.has(period)) continue;
    return candidate;
  }
  // Three years of taken months is not a state the studio can reach.
  return `${today.slice(0, 7)}-${day}`;
}

/* ---------------------------------------------------------------- gallery */

/** One card in the public gallery: what was mailed, by whom, when. */
export const galleryCardSchema = z.object({
  mailingId: z.string(),
  design: postcardDesignSchema,
  title: z.string().nullable(),
  mailDate: mailDateSchema,
  artist: artistSummarySchema.pick({ id: true, slug: true, name: true }),
});

export const galleryPageSchema = z.object({
  cards: z.array(galleryCardSchema),
  nextCursor: z.string().nullable(),
});

export type GalleryCard = z.infer<typeof galleryCardSchema>;
export type GalleryPage = z.infer<typeof galleryPageSchema>;

/* ---------------------------------------------------------------- payouts */

/**
 * What one sent card earned its artist, and whether it has been sent on.
 *
 *   pending  earned; waiting for the artist's Stripe account, or the next sweep
 *   paid     transferred; `stripeTransferId` is Stripe's
 *   failed   Stripe refused the transfer; `lastError` says why
 */
export const payoutStatusSchema = z.enum(["pending", "paid", "failed"]);
export type PayoutStatus = z.infer<typeof payoutStatusSchema>;

export const payoutSchema = z.object({
  id: z.string(),
  artistId: z.string(),
  postcardId: z.string(),
  mailingId: z.string(),
  /** The subscriber's monthly price at the time. */
  grossCents: centsSchema,
  printCostCents: centsSchema,
  platformFeeCents: centsSchema,
  amountCents: centsSchema,
  currency: z.string(),
  status: payoutStatusSchema,
  stripeTransferId: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.number().int(),
  paidAt: z.number().int().nullable(),
});

export const earningsSchema = z.object({
  currency: z.string(),
  pendingCents: centsSchema,
  paidCents: centsSchema,
  /** Cards sent to subscribers, all time. */
  sentCount: z.number().int(),
  payouts: z.array(payoutSchema),
});

export type Payout = z.infer<typeof payoutSchema>;
export type Earnings = z.infer<typeof earningsSchema>;

/* ------------------------------------------------------------- receipts */

/**
 * A "postcard order": one paid Stripe invoice under a subscription — the
 * thing a subscriber's receipts page lists and the admin reconciles against.
 */
export const orderStatusSchema = z.enum(["paid", "refunded"]);

export const orderSchema = z.object({
  id: z.string(),
  reference: z.string(),
  subscriptionId: z.string(),
  artist: artistSummarySchema.pick({ id: true, slug: true, name: true }),
  status: orderStatusSchema,
  amountCents: centsSchema,
  refundedCents: centsSchema,
  currency: z.string(),
  /** The month this payment covers, as epoch milliseconds. */
  periodStart: z.number().int().nullable(),
  periodEnd: z.number().int().nullable(),
  createdAt: z.number().int(),
});

export type Order = z.infer<typeof orderSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** A short reference derived from the row id, so a Stripe id is never shown. */
export function orderReference(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/* ---------------------------------------------------- a card, as received */

/** A card as the person it was mailed to sees it: which artist, which mailing, where it is. */
export const receivedPostcardSchema = postcardSchema.extend({
  mailingId: z.string(),
  title: z.string().nullable(),
  artist: artistSummarySchema.pick({ id: true, slug: true, name: true }),
  design: postcardDesignSchema,
});

export type ReceivedPostcard = z.infer<typeof receivedPostcardSchema>;
