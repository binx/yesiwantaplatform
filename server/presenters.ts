import {
  artistPublicSchema,
  artistStudioSchema,
  artistSummarySchema,
  collectionSchema,
  editionSchema,
  editionStudioSchema,
  editionSummarySchema,
  galleryEditionSchema,
  payoutSchema,
  receivedPostcardSchema,
  type ArtistPublic,
  type ArtistStudio,
  type ArtistSummary,
  type Collection,
  type Edition,
  type EditionStudio,
  type EditionSummary,
  type GalleryEdition,
  type Payout,
  type ReceivedPostcard,
} from "../shared/platform.js";
import type { Postcard, PostcardDesign } from "../shared/postcards.js";
import type { ArtistCounts, ArtistRecord } from "../db/artists-repository.js";
import { countForArtists, findArtistsByIds } from "../db/artists-repository.js";
import { findDesignsByIds, toPublicDesign, type Design } from "../db/designs-repository.js";
import {
  findEditionCardsByIds,
  findEditionsByIds,
  listCardsForEditions,

  listOnSaleEditionsForArtists,
  type EditionCardRecord,
  type EditionRecord,
} from "../db/editions-repository.js";
import { countCollectorsForEditions, type PurchaseRecord } from "../db/purchases-repository.js";
import type { PayoutRecord } from "../db/payouts-repository.js";
import { countPostcardsByEdition, listSchedules, type PostcardWithContext, type ScheduleEntry } from "../db/postcards-repository.js";
import { renderMarkdown } from "./markdown.js";

/**
 * From rows to what each audience may see.
 *
 * Every function here parses its result with the shared schema, so a field
 * that should never leave the server — a print path, a Stripe id, Lob's
 * error text on a collector's card — is refused by the schema rather than
 * forgotten by a hand-written mapping.
 */

const NO_COUNTS: ArtistCounts = { collectors: 0, mailed: 0 };

export function toPublicArtist(artist: ArtistRecord, counts: ArtistCounts = NO_COUNTS, currency = "USD"): ArtistPublic {
  return artistPublicSchema.parse({
    id: artist.id,
    slug: artist.slug,
    name: artist.name,
    bioHtml: renderMarkdown(artist.bio),
    avatar: artist.avatar,
    banner: artist.banner,
    links: artist.links,
    currency,
    status: artist.status,
    visibility: artist.visibility,
    collectorCount: counts.collectors,
    mailedCount: counts.mailed,
    createdAt: artist.createdAt,
  });
}

/** The tile's picture is the newest on-sale edition that has a banner; a card is never shown before it is mailed. */
export function toArtistSummary(artist: ArtistRecord, counts: ArtistCounts = NO_COUNTS, currency = "USD", onSale: EditionRecord[] = []): ArtistSummary {
  const newest = [...onSale].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).find((edition) => edition.banner);
  return artistSummarySchema.parse({
    id: artist.id,
    slug: artist.slug,
    name: artist.name,
    avatar: artist.avatar,
    currency,
    collectorCount: counts.collectors,
    mailedCount: counts.mailed,
    banner: newest?.banner ?? null,
    fromPriceCents: onSale.length > 0 ? Math.min(...onSale.map((edition) => edition.priceCents)) : null,
    editionCount: onSale.length,
  });
}

/** Summaries for many artists: their counts and editions on sale in two grouped queries. */
export async function summariseArtists(artists: ArtistRecord[], currency: string): Promise<ArtistSummary[]> {
  const ids = artists.map((artist) => artist.id);
  const [counts, onSale] = await Promise.all([countForArtists(ids), listOnSaleEditionsForArtists(ids)]);
  return artists.map((artist) =>
    toArtistSummary(
      artist,
      counts.get(artist.id),
      currency,
      onSale.filter((edition) => edition.artistId === artist.id),
    ),
  );
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

/** The link an artist summary carries on a collection, a card or a gallery entry. */
function artistLink(artist: ArtistRecord | undefined, id: string): { id: string; slug: string; name: string; avatar: ArtistRecord["avatar"] } {
  return artist
    ? { id: artist.id, slug: artist.slug, name: artist.name, avatar: artist.avatar }
    : { id, slug: "unknown", name: "An artist", avatar: null };
}

/* --------------------------------------------------------------- editions */

interface EditionContext {
  cards: Map<string, EditionCardRecord[]>;
  designs: Map<string, Design>;
  collectors: Map<string, number>;
}

/** Everything an edition list needs, loaded once for all of them. */
async function loadEditionContext(editions: EditionRecord[]): Promise<EditionContext> {
  const ids = editions.map((edition) => edition.id);
  const [cards, collectors] = await Promise.all([listCardsForEditions(ids), countCollectorsForEditions(ids)]);
  const designIds = [...cards.values()].flat().map((card) => card.designId);
  const designs = await findDesignsByIds(designIds);
  return { cards, designs: new Map(designs.map((design) => [design.id, design])), collectors };
}

function presentCards(edition: EditionRecord, context: EditionContext, artistName: string) {
  return (context.cards.get(edition.id) ?? []).flatMap((card) => {
    const design = context.designs.get(card.designId);
    if (!design) return [];
    return [{ id: card.id, position: card.position, title: card.title, design: toPublicDesign(design, card.title ?? `${edition.title}, card ${card.position}, by ${artistName}`) }];
  });
}

function editionFields(edition: EditionRecord, collectors: Map<string, number>, currency: string) {
  return {
    id: edition.id,
    artistId: edition.artistId,
    slug: edition.slug,
    title: edition.title,
    descriptionHtml: renderMarkdown(edition.description),
    banner: edition.banner,
    cardCount: edition.cardCount,
    priceCents: edition.priceCents,
    currency,
    status: edition.status,
    inGallery: edition.inGallery,
    collectorCount: collectors.get(edition.id) ?? 0,
    createdAt: edition.createdAt,
  };
}

/** Editions as a visitor sees them: the banner and the writeup, never the cards. Nothing about them is even loaded. */
export async function presentEditions(editions: EditionRecord[], currency: string): Promise<Edition[]> {
  const collectors = await countCollectorsForEditions(editions.map((edition) => edition.id));
  return editions.map((edition) => editionSchema.parse(editionFields(edition, collectors, currency)));
}

/** Editions as a list. */
export async function summariseEditions(editions: EditionRecord[], currency: string): Promise<EditionSummary[]> {
  const collectors = await countCollectorsForEditions(editions.map((edition) => edition.id));
  return editions.map((edition) => editionSummarySchema.parse(editionFields(edition, collectors, currency)));
}

/** Editions as their artist sees them: every card, the Markdown, and how the cards are moving. */
export async function presentStudioEditions(editions: EditionRecord[], currency: string, artistName: string): Promise<EditionStudio[]> {
  const [context, postcards] = await Promise.all([loadEditionContext(editions), countPostcardsByEdition(editions.map((edition) => edition.id))]);
  return editions.map((edition) =>
    editionStudioSchema.parse({
      ...editionFields(edition, context.collectors, currency),
      cards: presentCards(edition, context, artistName),
      description: edition.description,
      sentCount: postcards.get(edition.id)?.sent ?? 0,
      scheduledCount: postcards.get(edition.id)?.scheduled ?? 0,
    }),
  );
}

/* -------------------------------------------------------------- purchases */

const UNSENT = new Set(["scheduled", "sending", "error"]);

function progress(schedule: ScheduleEntry[]): { sentCount: number; nextMailDate: string | null } {
  return {
    sentCount: schedule.filter((entry) => entry.status === "sent").length,
    nextMailDate: schedule.find((entry) => UNSENT.has(entry.status))?.mailDate ?? null,
  };
}

/**
 * Purchases as their collectors see them: the edition and its banner, the
 * schedule, and how far along it is. Everything resolved in a handful of
 * grouped queries.
 */
export async function presentCollections(purchases: PurchaseRecord[]): Promise<Collection[]> {
  const [artists, editions, schedules] = await Promise.all([
    findArtistsByIds(purchases.map((purchase) => purchase.artistId)),
    findEditionsByIds(purchases.map((purchase) => purchase.editionId)),
    listSchedules(purchases.map((purchase) => purchase.id)),
  ]);
  const artistById = new Map(artists.map((artist) => [artist.id, artist]));
  const editionById = new Map(editions.map((edition) => [edition.id, edition]));

  return purchases.map((purchase) => {
    const artist = artistById.get(purchase.artistId);
    const edition = editionById.get(purchase.editionId);
    const schedule = schedules.get(purchase.id) ?? [];
    return collectionSchema.parse({
      id: purchase.id,
      artist: artistLink(artist, purchase.artistId),
      edition: { id: purchase.editionId, slug: edition?.slug ?? "unknown", title: edition?.title ?? "An edition", banner: edition?.banner ?? null },
      status: purchase.status,
      priceCents: purchase.priceCents,
      refundedCents: purchase.refundedCents,
      currency: purchase.currency,
      cardCount: purchase.cardCount,
      cadence: purchase.cadence,
      startDate: purchase.startDate,
      address: purchase.address,
      ...progress(schedule),
      schedule,
      createdAt: purchase.createdAt,
      paidAt: purchase.paidAt,
    });
  });
}

/* ---------------------------------------------------------------- gallery */

/** Editions in the gallery: each one's summary, with the artist who makes it. */
export async function presentGalleryEditions(editions: EditionRecord[], currency: string): Promise<GalleryEdition[]> {
  const [collectors, artists] = await Promise.all([
    countCollectorsForEditions(editions.map((edition) => edition.id)),
    findArtistsByIds(editions.map((edition) => edition.artistId)),
  ]);
  const artistById = new Map(artists.map((artist) => [artist.id, artist]));
  return editions.map((edition) =>
    galleryEditionSchema.parse({ ...editionFields(edition, collectors, currency), artist: artistLink(artistById.get(edition.artistId), edition.artistId) }),
  );
}


/* ------------------------------------------------------- cards, as mailed */

/**
 * A card as anyone but the admin may see it: the same shape, minus Lob's
 * error text and attempt counts. Those are for the person who can act on
 * them; a collector whose card is stuck needs "we're looking into it".
 */
export function stripForCustomer(postcard: Postcard): Postcard {
  return { ...postcard, lastError: null, attempts: 0 };
}

export function toReceivedPostcard(
  card: PostcardWithContext,
  editionCard: EditionCardRecord | undefined,
  edition: EditionRecord | undefined,
  artist: ArtistRecord | undefined,
  design: PostcardDesign,
): ReceivedPostcard {
  return receivedPostcardSchema.parse({
    ...stripForCustomer(card),
    title: editionCard?.title ?? null,
    cardCount: edition?.cardCount ?? 6,
    artist: artistLink(artist, card.artistId),
    edition: { id: card.editionId, slug: edition?.slug ?? "unknown", title: edition?.title ?? "An edition" },
    design,
  });
}

/** Cards for one person, with their editions, titles and artists resolved in one pass. */
export async function presentReceivedPostcards(cards: PostcardWithContext[]): Promise<ReceivedPostcard[]> {
  const [artists, designs, editions, editionCards] = await Promise.all([
    findArtistsByIds(cards.map((card) => card.artistId)),
    findDesignsByIds(cards.map((card) => card.designId)),
    findEditionsByIds(cards.map((card) => card.editionId)),
    findEditionCardsByIds(cards.map((card) => card.editionCardId)),
  ]);
  const artistById = new Map(artists.map((artist) => [artist.id, artist]));
  const designById = new Map(designs.map((design) => [design.id, design]));
  const editionById = new Map(editions.map((edition) => [edition.id, edition]));
  const editionCardById = new Map(editionCards.map((card) => [card.id, card]));

  return cards.flatMap((card) => {
    const design = designById.get(card.designId);
    if (!design) return [];
    const artist = artistById.get(card.artistId);
    return [
      toReceivedPostcard(
        card,
        editionCardById.get(card.editionCardId),
        editionById.get(card.editionId),
        artist,
        toPublicDesign(design, `A postcard by ${artist?.name ?? "an artist"}`),
      ),
    ];
  });
}

/* ---------------------------------------------------------------- payouts */

export function toPayout(payout: PayoutRecord): Payout {
  return payoutSchema.parse({
    id: payout.id,
    artistId: payout.artistId,
    postcardId: payout.postcardId,
    purchaseId: payout.purchaseId,
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
