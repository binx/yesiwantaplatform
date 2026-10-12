import { z } from "zod";
import { centsSchema, imageSchema, slugSchema, RESERVED_PAGE_SLUGS } from "./schema.js";
import { addDaysIso, mailDateSchema, postcardDesignSchema, postcardSchema, recipientSchema } from "./postcards.js";

/**
 * The platform's own nouns: artists, the editions they make, the purchases
 * collectors pay for once, and the payouts each sent card earns.
 *
 * Everything here is validated on both sides of the wire, and nothing here
 * carries a price the server would trust: an edition's price is read from
 * its row at checkout, and every payout amount is computed on the server
 * from the purchase's own snapshot.
 */

/* ---------------------------------------------------------------- artists */

/** An artist's address under `/artist/`. Three characters at least, so `/artist/me` is not a thing. */
export const artistSlugSchema = slugSchema.min(3, "Use at least 3 characters.").max(40, "40 characters at most.").superRefine((value, ctx) => {
  const owner = RESERVED_PAGE_SLUGS[value];
  if (owner) ctx.addIssue({ code: "custom", message: `"${value}" is already ${owner}. Choose a different address.` });
});

/** The site path of an artist's page. The one place the word is spelled out. */
export function artistPath(slug: string): string {
  return `/artist/${slug}`;
}

/** The site path of one of their editions. */
export function editionPath(artistSlug: string, editionSlug: string): string {
  return `${artistPath(artistSlug)}/${editionSlug}`;
}

/**
 * Somewhere else the artist is: a website, a shop, a social account.
 *
 * The address must be a full `https://` (or `http://`) URL, because it ends
 * up in an `href` on a public page. The label is optional; a blank one is
 * shown as the site's hostname.
 */
export const artistLinkSchema = z.object({
  label: z.string().trim().max(40, "40 characters at most.").default(""),
  url: z
    .string()
    .trim()
    .max(500, "500 characters at most.")
    .url("Use a full address, starting with https://.")
    .refine((value) => value.startsWith("https://") || value.startsWith("http://"), "Use a full address, starting with https://."),
});

/** How many links an artist may list. Enough for a website and the usual accounts. */
export const MAX_ARTIST_LINKS = 8;

export const artistLinksSchema = z.array(artistLinkSchema).max(MAX_ARTIST_LINKS, `${MAX_ARTIST_LINKS} links at most.`).default([]);

/** The words for a link with no label: the hostname, without a leading "www.". */
export function artistLinkLabel(link: { label: string; url: string }): string {
  if (link.label) return link.label;
  try {
    return new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    return link.url;
  }
}

/**
 * Where an artist is in the world, as the visitor sees it.
 *
 *   draft   the page is being written; only its owner can see it
 *   live    listed; its editions on sale can be collected
 *   paused  the artist stopped: no new collectors on any edition, while
 *           everyone who already paid keeps receiving their cards
 */
export const artistStatusSchema = z.enum(["draft", "live", "paused"]);
export type ArtistStatus = z.infer<typeof artistStatusSchema>;

/**
 * Whether the artist's editions join the shared gallery.
 *
 *   public   each edition they put on sale can appear in the gallery
 *   private  their editions are only ever on their own page
 *
 * Independent of `status`: a private artist is still listed and collectable.
 */
export const artistVisibilitySchema = z.enum(["public", "private"]);
export type ArtistVisibility = z.infer<typeof artistVisibilitySchema>;

/** An artist as any visitor may see them. Nothing about money: prices are on their editions. */
export const artistPublicSchema = z.object({
  id: z.string(),
  slug: artistSlugSchema,
  name: z.string().min(1),
  /** Sanitised HTML rendered from the artist's Markdown. */
  bioHtml: z.string().default(""),
  avatar: imageSchema.nullable().default(null),
  /** A wide picture across the top of the page. */
  banner: imageSchema.nullable().default(null),
  /** Where else to find them: a website, a shop, social accounts. */
  links: artistLinksSchema,
  currency: z.string().length(3),
  status: artistStatusSchema,
  visibility: artistVisibilitySchema,
  /** People who have paid for one of their editions, all time. */
  collectorCount: z.number().int().min(0),
  /** How many cards this artist has mailed to collectors, all time. */
  mailedCount: z.number().int().min(0),
  createdAt: z.number().int(),
});

/** One artist in the directory: enough for a tile. */
export const artistSummarySchema = artistPublicSchema.pick({
  id: true,
  slug: true,
  name: true,
  avatar: true,
  currency: true,
  collectorCount: true,
  mailedCount: true,
}).extend({
  /** The newest on-sale edition's banner, for the tile's picture. Never a card: those are the surprise. */
  banner: imageSchema.nullable().default(null),
  /** The cheapest edition on sale, for "from $30". Null when nothing is. */
  fromPriceCents: centsSchema.nullable().default(null),
  /** How many editions are on sale. */
  editionCount: z.number().int().min(0).default(0),
});

export const artistProfileInputSchema = z.object({
  slug: artistSlugSchema,
  name: z.string().trim().min(1, "A name is required.").max(80, "80 characters at most."),
  /** Markdown. Rendered and sanitised on the way out, like a page. */
  bio: z.string().max(10_000).default(""),
  visibility: artistVisibilitySchema.default("public"),
  avatar: imageSchema.nullable().default(null),
  /** Required: a page always has a picture across the top. Rows made before this was so may still lack one. */
  banner: imageSchema,
  links: artistLinksSchema,
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

export type ArtistLink = z.infer<typeof artistLinkSchema>;
export type ArtistPublic = z.infer<typeof artistPublicSchema>;
export type ArtistSummary = z.infer<typeof artistSummarySchema>;
export type ArtistProfileInput = z.infer<typeof artistProfileInputSchema>;
export type ArtistStudio = z.infer<typeof artistStudioSchema>;

/* --------------------------------------------------------------- editions */

/** How many cards an edition holds. Round numbers, and never fewer than six. */
export const EDITION_SIZES = [6, 12] as const;
export const editionSizeSchema = z.union([z.literal(6), z.literal(12)], { message: "An edition is 6 or 12 cards." });
export type EditionSize = z.infer<typeof editionSizeSchema>;

/**
 * How often a collector's cards arrive. The collector's choice, made at
 * checkout and snapshotted on their purchase: an edition itself has no
 * cadence, only a size.
 *
 *   monthly        on one day of every month
 *   twice_monthly  on two days of every month, fourteen days apart
 */
export const cadenceSchema = z.enum(["monthly", "twice_monthly"]);
export type Cadence = z.infer<typeof cadenceSchema>;

/**
 * Where an edition is in its life.
 *
 *   draft    being made; only its artist sees it, and everything can change
 *   on_sale  listed and collectable. Its cards, size and price are
 *            fixed — collectors paid for exactly these — and only its words
 *            and banner can change. Back to draft only while nobody has
 *            bought it
 *   closed   no new collectors; everyone who paid still gets every card
 */
export const editionStatusSchema = z.enum(["draft", "on_sale", "closed"]);
export type EditionStatus = z.infer<typeof editionStatusSchema>;

/** One card of an edition, in its place. Position 1 goes first. */
export const editionCardSchema = z.object({
  id: z.string(),
  position: z.number().int().min(1),
  title: z.string().nullable(),
  design: postcardDesignSchema,
});

/**
 * An edition as any visitor may see it. The cards are not here: they are a
 * surprise, and a visitor sees the banner and the artist's writeup of what
 * will arrive. A collector sees each card once it has been mailed to them.
 */
export const editionSchema = z.object({
  id: z.string(),
  artistId: z.string(),
  slug: slugSchema,
  title: z.string().min(1),
  /** Sanitised HTML rendered from the artist's Markdown: what collectors will get. */
  descriptionHtml: z.string().default(""),
  /** A wide picture across the top of the edition's page, standing in for the cards. */
  banner: imageSchema.nullable().default(null),
  cardCount: editionSizeSchema,
  /** For the whole set. */
  priceCents: centsSchema,
  currency: z.string().length(3),
  status: editionStatusSchema,
  /** Whether it is shown in the shared gallery while on sale. */
  inGallery: z.boolean(),
  /** Paid purchases, all time. */
  collectorCount: z.number().int().min(0),
  createdAt: z.number().int(),
});

/** One edition in a list: enough for a tile, or a feature on its artist's page. */
export const editionSummarySchema = editionSchema.pick({
  id: true,
  slug: true,
  title: true,
  descriptionHtml: true,
  banner: true,

  cardCount: true,
  priceCents: true,
  currency: true,
  status: true,
  collectorCount: true,
});

/** What the artist's studio shows: the public edition, plus its cards, its Markdown and how its cards are moving. */
export const editionStudioSchema = editionSchema.extend({
  cards: z.array(editionCardSchema),
  description: z.string(),
  /** Cards accepted by Lob across every collector. */
  sentCount: z.number().int().min(0),
  /** Cards still to come across every collector. */
  scheduledCount: z.number().int().min(0),
});

export const editionInputSchema = z.object({
  slug: slugSchema.max(60, "60 characters at most."),
  title: z.string().trim().min(1, "A title is required.").max(80, "80 characters at most."),
  /** Markdown: what collectors will get. Rendered and sanitised on the way out. */
  description: z.string().max(10_000).default(""),
  banner: imageSchema.nullable().default(null),
  cardCount: editionSizeSchema,
  priceCents: centsSchema.min(50, "Stripe cannot charge less than 50 cents."),
  inGallery: z.boolean().default(true),
});

/** The cards of a draft edition, in order. Replaces the whole set. */
export const editionCardsInputSchema = z.object({
  cards: z
    .array(z.object({ designId: z.string().min(1), title: z.string().trim().max(120).nullable().default(null) }))
    .max(12, "12 cards at most.")
    .refine((cards) => new Set(cards.map((card) => card.designId)).size === cards.length, "Each design can be in an edition once."),
});

export type EditionCard = z.infer<typeof editionCardSchema>;
export type Edition = z.infer<typeof editionSchema>;
export type EditionSummary = z.infer<typeof editionSummarySchema>;
export type EditionStudio = z.infer<typeof editionStudioSchema>;
export type EditionInput = z.infer<typeof editionInputSchema>;
export type EditionCardsInput = z.infer<typeof editionCardsInputSchema>;

/* --------------------------------------------------------------- schedule */

/** Where a collector's run starts if they do not pick a day: the next 1st or 15th. */
export const DEFAULT_MAIL_DAYS = [1, 15] as const;

/** How far ahead a collector may start a run. */
export const START_DATE_MAX_DAYS = 90;

/**
 * The days of the month a run lands on, from the day it starts. Monthly is
 * that one day; twice a month is that day and the one fourteen days from it,
 * both within the 1st to the 28th, so the default start of the 1st gives the
 * 1st and the 15th.
 */
export function mailDaysFor(cadence: Cadence, startDay: number): number[] {
  if (cadence === "monthly") return [startDay];
  return startDay <= 14 ? [startDay, startDay + 14] : [startDay - 14, startDay];
}

/**
 * Every mail date of a run, card 1 first. Pure calendar arithmetic on
 * YYYY-MM-DD strings: the start date itself, then each later mail day in
 * turn until the set is done.
 */
export function editionSchedule(startDate: string, cardCount: number, cadence: Cadence): string[] {
  const [year, month, day] = startDate.split("-").map(Number) as [number, number, number];
  const days = mailDaysFor(cadence, day);
  const dates: string[] = [];
  for (let offset = 0; dates.length < cardCount; offset += 1) {
    const period = new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
    for (const mailDay of days) {
      const candidate = `${period}-${String(mailDay).padStart(2, "0")}`;
      if (candidate >= startDate && dates.length < cardCount) dates.push(candidate);
    }
  }
  return dates;
}

/** The next 1st or 15th after `today`. */
export function defaultStartDate(today: string): string {
  for (let offset = 1; offset <= 31; offset += 1) {
    const candidate = addDaysIso(today, offset);
    if ((DEFAULT_MAIL_DAYS as readonly number[]).includes(Number(candidate.slice(8)))) return candidate;
  }
  return addDaysIso(today, 1);
}

/** The earliest and latest start date a collector may pick today. */
export function startDateRange(today: string): { min: string; max: string } {
  return { min: addDaysIso(today, 1), max: addDaysIso(today, START_DATE_MAX_DAYS) };
}

/** Why a start date cannot be used, in words for the form; null when it can. */
export function startDateProblem(startDate: string, today: string): string | null {
  const { min, max } = startDateRange(today);
  if (startDate < min) return "Pick a day after today.";
  if (startDate > max) return `Pick a day within the next ${START_DATE_MAX_DAYS} days.`;
  if (Number(startDate.slice(8)) > 28) return "Pick a day from the 1st to the 28th, so every month has it.";
  return null;
}

/* -------------------------------------------------------------- purchases */

/**
 * A purchase's state.
 *
 *   incomplete  Checkout was started; the webhook has not confirmed payment
 *   paid        confirmed; every card of the run is scheduled
 *   refunded    refunded in full; the cards not yet sent were cancelled
 */
export const purchaseStatusSchema = z.enum(["incomplete", "paid", "refunded"]);
export type PurchaseStatus = z.infer<typeof purchaseStatusSchema>;

/** One card of a run, as its collector sees the schedule. */
export const scheduledCardSchema = z.object({
  position: z.number().int().min(1),
  mailDate: mailDateSchema,
  status: postcardSchema.shape.status,
});

/** A purchase as its collector sees it: what they bought, where it goes, and how far along it is. */
export const collectionSchema = z.object({
  id: z.string(),
  artist: artistSummarySchema.pick({ id: true, slug: true, name: true, avatar: true }),
  edition: z.object({ id: z.string(), slug: z.string(), title: z.string(), banner: imageSchema.nullable() }),
  status: purchaseStatusSchema,
  /** What they paid for the whole set — a snapshot of the edition's price. */
  priceCents: centsSchema,
  refundedCents: centsSchema,
  currency: z.string(),
  cardCount: editionSizeSchema,
  cadence: cadenceSchema,
  startDate: mailDateSchema,
  /** Where the cards go. */
  address: recipientSchema,
  /** Cards accepted by Lob so far. */
  sentCount: z.number().int().min(0),
  /** The next card's day, or null when none is still to come. */
  nextMailDate: mailDateSchema.nullable(),
  schedule: z.array(scheduledCardSchema),
  createdAt: z.number().int(),
  paidAt: z.number().int().nullable(),
});

/** Collect an edition: which one, where to mail it, how often, and optionally when to start. The price is never sent. */
export const collectInputSchema = z.object({
  editionId: z.string().min(1),
  address: recipientSchema,
  /** How often the cards come. Left out, one a month. */
  cadence: cadenceSchema.default("monthly"),
  /** The first card's day. Left out, it is the next 1st or 15th. */
  startDate: mailDateSchema.optional(),
});

export const collectResponseSchema = z.object({
  url: z.string().url(),
  purchaseId: z.string(),
});

export type ScheduledCard = z.infer<typeof scheduledCardSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type CollectInput = z.infer<typeof collectInputSchema>;
export type CollectResponse = z.infer<typeof collectResponseSchema>;

/* ---------------------------------------------------------------- gallery */

/**
 * One edition in the public gallery: the edition, and who makes it. Never a
 * card — the cards are the surprise, and the gallery is where a visitor
 * picks whose surprises they want.
 */
export const galleryEditionSchema = editionSummarySchema.extend({
  artist: artistSummarySchema.pick({ id: true, slug: true, name: true, avatar: true }),
});

export const galleryPageSchema = z.object({
  editions: z.array(galleryEditionSchema),
  nextCursor: z.string().nullable(),
});

export type GalleryEdition = z.infer<typeof galleryEditionSchema>;
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
  purchaseId: z.string(),
  /** This card's part of what the collector paid. */
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

export type Payout = z.infer<typeof payoutSchema>;

/* ---------------------------------------------------- a card, as received */

/** A card as the person it was mailed to sees it: which artist, which edition, which card of it, where it is. */
export const receivedPostcardSchema = postcardSchema.extend({
  title: z.string().nullable(),
  cardCount: editionSizeSchema,
  artist: artistSummarySchema.pick({ id: true, slug: true, name: true }),
  edition: z.object({ id: z.string(), slug: z.string(), title: z.string() }),
  design: postcardDesignSchema,
});

export type ReceivedPostcard = z.infer<typeof receivedPostcardSchema>;
