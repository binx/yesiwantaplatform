import {
  artistPublicSchema,
  artistStudioSchema,
  artistSummarySchema,
  galleryCardSchema,
  mailingSchema,
  orderReference,
  orderSchema,
  payoutSchema,
  receivedPostcardSchema,
  subscriberSchema,
  subscriptionSchema,
  type ArtistPublic,
  type ArtistStudio,
  type ArtistSummary,
  type GalleryCard,
  type Mailing,
  type Order,
  type Payout,
  type ReceivedPostcard,
  type Subscriber,
  type Subscription,
} from "../shared/platform.js";
import type { Postcard, PostcardDesign } from "../shared/postcards.js";
import type { ArtistCounts, ArtistRecord } from "../db/artists-repository.js";
import { countForArtists, findArtistsByIds, latestMailedDesignIds } from "../db/artists-repository.js";
import { findDesignsByIds, toPublicDesign, type Design } from "../db/designs-repository.js";
import type { MailingCounts, MailingRecord } from "../db/mailings-repository.js";
import type { OrderRecord } from "../db/orders-repository.js";
import type { PayoutRecord } from "../db/payouts-repository.js";
import type { PostcardWithContext } from "../db/postcards-repository.js";
import type { SubscriptionRecord } from "../db/subscriptions-repository.js";
import { renderMarkdown } from "./markdown.js";

/**
 * From rows to what each audience may see.
 *
 * Every function here parses its result with the shared schema, so a field
 * that should never leave the server — a print path, a Stripe id, Lob's
 * error text on a subscriber's card — is refused by the schema rather than
 * forgotten by a hand-written mapping.
 */

const NO_COUNTS: ArtistCounts = { subscribers: 0, mailed: 0 };

export function toPublicArtist(artist: ArtistRecord, counts: ArtistCounts = NO_COUNTS, currency = "USD"): ArtistPublic {
  return artistPublicSchema.parse({
    id: artist.id,
    slug: artist.slug,
    name: artist.name,
    tagline: artist.tagline,
    bioHtml: renderMarkdown(artist.bio),
    avatar: artist.avatar,
    monthlyPriceCents: artist.monthlyPriceCents,
    currency,
    status: artist.status,
    visibility: artist.visibility,
    sendDay: artist.sendDay,
    subscriberCount: counts.subscribers,
    mailedCount: counts.mailed,
    createdAt: artist.createdAt,
  });
}

export function toArtistSummary(artist: ArtistRecord, counts: ArtistCounts = NO_COUNTS, latest: Design | null = null, currency = "USD"): ArtistSummary {
  return artistSummarySchema.parse({
    id: artist.id,
    slug: artist.slug,
    name: artist.name,
    tagline: artist.tagline,
    avatar: artist.avatar,
    monthlyPriceCents: artist.monthlyPriceCents,
    currency,
    subscriberCount: counts.subscribers,
    mailedCount: counts.mailed,
    latest: latest ? toPublicDesign(latest, `A postcard by ${artist.name}`) : null,
  });
}

/** Summaries for many artists: their counts and latest card in two grouped queries. */
export async function summariseArtists(artists: ArtistRecord[], currency: string): Promise<ArtistSummary[]> {
  const ids = artists.map((artist) => artist.id);
  const [counts, latestIds] = await Promise.all([countForArtists(ids), latestMailedDesignIds(ids)]);
  const designs = await findDesignsByIds([...latestIds.values()]);
  const designById = new Map(designs.map((design) => [design.id, design]));
  return artists.map((artist) => {
    const latestId = latestIds.get(artist.id);
    return toArtistSummary(artist, counts.get(artist.id), latestId ? (designById.get(latestId) ?? null) : null, currency);
  });
}

export function toArtistStudio(artist: ArtistRecord, email: string, counts: ArtistCounts, currency: string): ArtistStudio {
  return artistStudioSchema.parse({
    ...toPublicArtist(artist, counts, currency),
    bio: artist.bio,
    payoutsEnabled: artist.payoutsEnabled,
    hasStripeAccount: artist.stripeAccountId !== null,
    email,
  });
}

/** The link an artist summary carries on a subscription, a card or an order. */
function artistLink(artist: ArtistRecord | undefined, id: string): { id: string; slug: string; name: string; avatar: ArtistRecord["avatar"] } {
  return artist
    ? { id: artist.id, slug: artist.slug, name: artist.name, avatar: artist.avatar }
    : { id, slug: "unknown", name: "An artist", avatar: null };
}

export function toSubscription(subscription: SubscriptionRecord, artist: ArtistRecord | undefined, postcardCount: number): Subscription {
  return subscriptionSchema.parse({
    id: subscription.id,
    artist: artistLink(artist, subscription.artistId),
    status: subscription.status,
    priceCents: subscription.priceCents,
    currency: subscription.currency,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    address: subscription.address,
    postcardCount,
    createdAt: subscription.createdAt,
    cancelledAt: subscription.cancelledAt,
  });
}

/** What the artist is told about one subscriber: a name and a town. Never the street. */
export function toSubscriber(subscription: SubscriptionRecord): Subscriber {
  return subscriberSchema.parse({
    id: subscription.id,
    name: subscription.address.name,
    city: subscription.address.city,
    country: subscription.address.country,
    status: subscription.status,
    since: subscription.createdAt,
  });
}

const EMPTY_MAILING_COUNTS: MailingCounts = { scheduled: 0, sent: 0, error: 0, cancelled: 0 };

export function toMailing(mailing: MailingRecord, design: Design, counts: MailingCounts = EMPTY_MAILING_COUNTS, artistName = "the artist"): Mailing {
  return mailingSchema.parse({
    id: mailing.id,
    artistId: mailing.artistId,
    design: toPublicDesign(design, mailing.title ?? `A postcard by ${artistName}`),
    title: mailing.title,
    mailDate: mailing.mailDate,
    period: mailing.period,
    status: mailing.status,
    inGallery: mailing.inGallery,
    subscriberCount: mailing.subscriberCount,
    postcards: counts,
    mailedAt: mailing.mailedAt,
    createdAt: mailing.createdAt,
  });
}

export function toGalleryCard(mailing: MailingRecord, design: Design, artist: ArtistRecord): GalleryCard {
  return galleryCardSchema.parse({
    mailingId: mailing.id,
    design: toPublicDesign(design, mailing.title ?? `A postcard by ${artist.name}`),
    title: mailing.title,
    mailDate: mailing.mailDate,
    artist: { id: artist.id, slug: artist.slug, name: artist.name },
  });
}

/**
 * A card as anyone but the admin may see it: the same shape, minus Lob's
 * error text and attempt counts. Those are for the person who can act on
 * them; a subscriber whose card is stuck needs "we're looking into it".
 */
export function stripForCustomer(postcard: Postcard): Postcard {
  return { ...postcard, lastError: null, attempts: 0 };
}

export function toReceivedPostcard(card: PostcardWithContext, mailing: MailingRecord | undefined, artist: ArtistRecord | undefined, design: PostcardDesign): ReceivedPostcard {
  return receivedPostcardSchema.parse({
    ...stripForCustomer(card),
    mailingId: card.mailingId,
    title: mailing?.title ?? null,
    artist: artistLink(artist, card.artistId),
    design,
  });
}

/** Cards for one person, with their mailings' titles and artists resolved in one pass. */
export async function presentReceivedPostcards(cards: PostcardWithContext[], mailings: Map<string, MailingRecord>): Promise<ReceivedPostcard[]> {
  const artists = await findArtistsByIds(cards.map((card) => card.artistId));
  const artistById = new Map(artists.map((artist) => [artist.id, artist]));
  const designs = await findDesignsByIds(cards.map((card) => card.designId));
  const designById = new Map(designs.map((design) => [design.id, design]));

  return cards.flatMap((card) => {
    const design = designById.get(card.designId);
    if (!design) return [];
    const artist = artistById.get(card.artistId);
    return [toReceivedPostcard(card, mailings.get(card.mailingId), artist, toPublicDesign(design, `A postcard by ${artist?.name ?? "an artist"}`))];
  });
}

export function toOrder(order: OrderRecord, artist: ArtistRecord | undefined): Order {
  return orderSchema.parse({
    id: order.id,
    reference: orderReference(order.id),
    subscriptionId: order.subscriptionId,
    artist: artistLink(artist, order.artistId),
    status: order.status,
    amountCents: order.amountCents,
    refundedCents: order.refundedCents,
    currency: order.currency,
    periodStart: order.periodStart,
    periodEnd: order.periodEnd,
    createdAt: order.createdAt,
  });
}

export function toPayout(payout: PayoutRecord): Payout {
  return payoutSchema.parse({
    id: payout.id,
    artistId: payout.artistId,
    postcardId: payout.postcardId,
    mailingId: payout.mailingId,
    grossCents: payout.grossCents,
    printCostCents: payout.printCostCents,
    platformFeeCents: payout.platformFeeCents,
    amountCents: payout.amountCents,
    currency: payout.currency,
    status: payout.status,
    stripeTransferId: payout.stripeTransferId,
    lastError: payout.lastError,
    createdAt: payout.createdAt,
    paidAt: payout.paidAt,
  });
}
