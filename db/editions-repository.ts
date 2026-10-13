import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";

import type { EditionInput, EditionSize, EditionStatus, ReviewInput } from "../shared/platform.js";
import type { Image } from "../shared/schema.js";
import { getDatabase } from "./client.js";
import { affectedRows, epochOrNull, isUniqueViolation, nowFor, timeFor, toBool, toCount, toEpochMs } from "./repository.js";

/**
 * Editions: the sets an artist sells, and the cards in each.
 *
 * An edition's cards, size and price can change only while it is a
 * `draft`; the conditional updates here are what hold that, so a route that
 * forgot to check could still not rewrite something a collector paid for.
 * Only `reviewEdition` moves one from review to `on_sale`: the admin's
 * decision is the one way an edition gets there the first time.
 */

export interface EditionRow {
  id: string;
  artistId: string;
  slug: string;
  title: string;
  description: string;
  bannerPath: string | null;
  bannerWidth: number | null;
  bannerHeight: number | null;
  bannerAlt: string | null;
  cardCount: number;
  priceCents: number;
  status: string;
  inGallery: unknown;
  reviewNote: string | null;
  submittedAt: unknown;
  reviewedAt: unknown;
  createdAt: unknown;
}

export interface EditionRecord {
  id: string;
  artistId: string;
  slug: string;
  title: string;
  description: string;
  banner: Image | null;
  cardCount: EditionSize;
  priceCents: number;
  status: EditionStatus;
  inGallery: boolean;
  reviewNote: string | null;
  submittedAt: number | null;
  reviewedAt: number | null;
  createdAt: number;
}

export interface EditionCardRow {
  id: string;
  editionId: string;
  designId: string;
  position: number;
  title: string | null;
  firstMailedAt: unknown;
}

export interface EditionCardRecord {
  id: string;
  editionId: string;
  designId: string;
  position: number;
  title: string | null;
  firstMailedAt: number | null;
}

export class EditionSlugTakenError extends Error {
  constructor(slug: string) {
    super(`You already have an edition at "${slug}". Choose a different address.`);
    this.name = "EditionSlugTakenError";
  }
}

function toStatus(value: string): EditionStatus {
  return value === "on_sale" || value === "closed" || value === "in_review" ? value : "draft";
}

export function buildEdition(row: EditionRow): EditionRecord {
  return {
    id: row.id,
    artistId: row.artistId,
    slug: row.slug,
    title: row.title,
    description: row.description,
    banner:
      row.bannerPath && row.bannerWidth && row.bannerHeight
        ? { path: row.bannerPath, width: row.bannerWidth, height: row.bannerHeight, alt: row.bannerAlt ?? "", widths: [] }
        : null,
    cardCount: row.cardCount === 12 ? 12 : 6,
    priceCents: row.priceCents,
    status: toStatus(row.status),
    inGallery: toBool(row.inGallery),
    reviewNote: row.reviewNote,
    submittedAt: epochOrNull(row.submittedAt),
    reviewedAt: epochOrNull(row.reviewedAt),
    createdAt: toEpochMs(row.createdAt),
  };
}

export function buildEditionCard(row: EditionCardRow): EditionCardRecord {
  return {
    id: row.id,
    editionId: row.editionId,
    designId: row.designId,
    position: row.position,
    title: row.title,
    firstMailedAt: epochOrNull(row.firstMailedAt),
  };
}

/* ----------------------------------------------------------------- writes */

function bannerColumns(banner: Image | null) {
  return {
    bannerPath: banner?.path ?? null,
    bannerWidth: banner?.width ?? null,
    bannerHeight: banner?.height ?? null,
    bannerAlt: banner?.alt ?? null,
  };
}

export async function createEdition(artistId: string, input: EditionInput, id = randomUUID()): Promise<EditionRecord> {
  const { drizzle: db, schema } = await getDatabase();
  try {
    await db.insert(schema.editions).values({
      id,
      artistId,
      slug: input.slug,
      title: input.title,
      description: input.description,
      ...bannerColumns(input.banner),
      cardCount: input.cardCount,
      priceCents: input.priceCents,
      inGallery: input.inGallery,
      status: "draft",
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new EditionSlugTakenError(input.slug);
    throw error;
  }
  const created = await getEdition(id);
  if (!created) throw new Error("The edition was not written.");
  return created;
}

/**
 * Change everything about a draft. Returns false once it has gone on sale.
 * Cards past a smaller size are removed with it, so a draft never holds more
 * cards than it says.
 */
export async function updateDraftEdition(id: string, artistId: string, input: EditionInput): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  let changed: boolean;
  try {
    const result = await db
      .update(schema.editions)
      .set({
        slug: input.slug,
        title: input.title,
        description: input.description,
        ...bannerColumns(input.banner),
        cardCount: input.cardCount,
        priceCents: input.priceCents,
        inGallery: input.inGallery,
        updatedAt: nowFor(dialect),
      })
      .where(and(eq(schema.editions.id, id), eq(schema.editions.artistId, artistId), eq(schema.editions.status, "draft")));
    changed = affectedRows(result) === 1;
  } catch (error) {
    if (isUniqueViolation(error)) throw new EditionSlugTakenError(input.slug);
    throw error;
  }
  if (changed) {
    const cards = await listCardsForEdition(id);
    const extra = cards.filter((card) => card.position > input.cardCount).map((card) => card.id);
    if (extra.length > 0) await db.delete(schema.editionCards).where(inArray(schema.editionCards.id, extra));
  }
  return changed;
}

/** The words and banner of an edition past draft, and its gallery flag. Nothing a collector paid for. */
export async function updateEditionWords(id: string, artistId: string, input: Pick<EditionInput, "title" | "description" | "banner" | "inGallery">): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.editions)
    .set({ title: input.title, description: input.description, ...bannerColumns(input.banner), inGallery: input.inGallery, updatedAt: nowFor(dialect) })
    .where(and(eq(schema.editions.id, id), eq(schema.editions.artistId, artistId)));
  return affectedRows(result) === 1;
}

/** Move an edition from one of `from` to `to`. Conditional, so two racing requests cannot both win. */
export async function setEditionStatus(id: string, from: EditionStatus[], to: EditionStatus): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.editions)
    .set({ status: to, updatedAt: nowFor(dialect) })
    .where(and(eq(schema.editions.id, id), inArray(schema.editions.status, from)));
  return affectedRows(result) === 1;
}

/** The artist sends a draft to the admin. The last decline's note goes with it. False unless it was a draft. */
export async function submitEditionForReview(id: string, artistId: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.editions)
    .set({ status: "in_review", reviewNote: null, submittedAt: nowFor(dialect), updatedAt: nowFor(dialect) })
    .where(and(eq(schema.editions.id, id), eq(schema.editions.artistId, artistId), eq(schema.editions.status, "draft")));
  return affectedRows(result) === 1;
}

/**
 * The admin's decision on an edition in review: approved puts it on sale,
 * declined sends it back to a draft with the note on it. False unless it
 * was in review, so two decisions cannot both land.
 */
export async function reviewEdition(id: string, input: ReviewInput): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.editions)
    .set({
      status: input.decision === "approved" ? "on_sale" : "draft",
      reviewNote: input.note || null,
      reviewedAt: nowFor(dialect),
      updatedAt: nowFor(dialect),
    })
    .where(and(eq(schema.editions.id, id), eq(schema.editions.status, "in_review")));
  return affectedRows(result) === 1;
}

/** Remove a draft. The route checks nobody has paid for it; the status check keeps an on-sale one safe regardless. */
export async function deleteDraftEdition(id: string, artistId: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const result = await db
    .delete(schema.editions)
    .where(and(eq(schema.editions.id, id), eq(schema.editions.artistId, artistId), eq(schema.editions.status, "draft")));
  return affectedRows(result) === 1;
}

/**
 * Set a draft's cards, in order, replacing whatever it held. Returns false
 * if the edition is not a draft. Every design must already be known to
 * belong to the artist; the route checks.
 */
export async function replaceEditionCards(editionId: string, cards: { designId: string; title: string | null }[]): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const edition = await getEdition(editionId);
  if (!edition || edition.status !== "draft") return false;

  await db.delete(schema.editionCards).where(eq(schema.editionCards.editionId, editionId));
  if (cards.length > 0) {
    await db.insert(schema.editionCards).values(
      cards.map((card, index) => ({ id: randomUUID(), editionId, designId: card.designId, position: index + 1, title: card.title })),
    );
  }
  return true;
}

/** The first time any copy of this card is accepted by Lob. Later ones change nothing. */
export async function markEditionCardMailed(id: string): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.editionCards)
    .set({ firstMailedAt: nowFor(dialect) })
    .where(and(eq(schema.editionCards.id, id), isNull(schema.editionCards.firstMailedAt)));
}

/* ------------------------------------------------------------------ reads */

async function findOne(where: unknown): Promise<EditionRecord | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db.select().from(schema.editions).where(where).limit(1)) as unknown as EditionRow[];
  const row = rows[0];
  return row ? buildEdition(row) : null;
}

export async function getEdition(id: string): Promise<EditionRecord | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.editions.id, id));
}

/** An edition, but only if it is this artist's: another artist's is a 404. */
export async function getEditionForArtist(id: string, artistId: string): Promise<EditionRecord | null> {
  const { schema } = await getDatabase();
  return findOne(and(eq(schema.editions.id, id), eq(schema.editions.artistId, artistId)));
}

export async function findEditionBySlug(artistId: string, slug: string): Promise<EditionRecord | null> {
  const { schema } = await getDatabase();
  return findOne(and(eq(schema.editions.artistId, artistId), eq(schema.editions.slug, slug)));
}

export async function findEditionsByIds(ids: string[]): Promise<EditionRecord[]> {
  if (ids.length === 0) return [];
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.editions)
    .where(inArray(schema.editions.id, [...new Set(ids)]))) as unknown as EditionRow[];
  return rows.map(buildEdition);
}

/** One artist's editions, newest first; `statuses` narrows it for the public page. */
export async function listEditionsForArtist(artistId: string, statuses?: EditionStatus[]): Promise<EditionRecord[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.editions)
    .where(and(eq(schema.editions.artistId, artistId), statuses ? inArray(schema.editions.status, statuses) : undefined))
    .orderBy(desc(schema.editions.createdAt), desc(schema.editions.id))) as unknown as EditionRow[];
  return rows.map(buildEdition);
}

/** The on-sale editions of many artists at once, for directory tiles. */
export async function listOnSaleEditionsForArtists(artistIds: string[]): Promise<EditionRecord[]> {
  if (artistIds.length === 0) return [];
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.editions)
    .where(and(inArray(schema.editions.artistId, [...new Set(artistIds)]), eq(schema.editions.status, "on_sale")))) as unknown as EditionRow[];
  return rows.map(buildEdition);
}

export interface EditionPage {
  editions: EditionRecord[];
  total: number;
}

/** Every edition on the platform, for the admin. */
export async function listEditions(options: { status?: EditionStatus; limit?: number; offset?: number } = {}): Promise<EditionPage> {
  const { drizzle: db, schema } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = options.status ? eq(schema.editions.status, options.status) : undefined;

  const [rows, totals] = await Promise.all([
    db.select().from(schema.editions).where(where).orderBy(desc(schema.editions.createdAt), desc(schema.editions.id)).limit(limit).offset(offset) as unknown as Promise<EditionRow[]>,
    db.select({ value: count() }).from(schema.editions).where(where) as unknown as Promise<{ value: unknown }[]>,
  ]);
  return { editions: rows.map(buildEdition), total: toCount(totals[0]?.value) };
}

/** For the admin overview. */
export async function countEditionsByStatus(): Promise<Record<string, number>> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ status: schema.editions.status, value: count() })
    .from(schema.editions)
    .groupBy(schema.editions.status)) as unknown as { status: string; value: unknown }[];
  return Object.fromEntries(rows.map((row) => [row.status, toCount(row.value)]));
}

/* ------------------------------------------------------------------ cards */

export async function listCardsForEdition(editionId: string): Promise<EditionCardRecord[]> {
  return (await listCardsForEditions([editionId])).get(editionId) ?? [];
}

/** The cards of many editions, each list in position order. */
export async function listCardsForEditions(editionIds: string[]): Promise<Map<string, EditionCardRecord[]>> {
  const map = new Map<string, EditionCardRecord[]>();
  if (editionIds.length === 0) return map;
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.editionCards)
    .where(inArray(schema.editionCards.editionId, [...new Set(editionIds)]))
    .orderBy(asc(schema.editionCards.editionId), asc(schema.editionCards.position))) as unknown as EditionCardRow[];
  for (const row of rows) {
    const card = buildEditionCard(row);
    const list = map.get(card.editionId);
    if (list) list.push(card);
    else map.set(card.editionId, [card]);
  }
  return map;
}

export async function findEditionCardsByIds(ids: string[]): Promise<EditionCardRecord[]> {
  if (ids.length === 0) return [];
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.editionCards)
    .where(inArray(schema.editionCards.id, [...new Set(ids)]))) as unknown as EditionCardRow[];
  return rows.map(buildEditionCard);
}

/* ---------------------------------------------------------------- gallery */

/** A cursor is the last edition's creation moment and id, so a page is stable while editions keep going on sale. */
function decodeCursor(cursor: string | undefined): { at: number; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  return at && id && Number.isFinite(Number(at)) ? { at: Number(at), id } : null;
}

function encodeCursor(edition: EditionRecord): string {
  return Buffer.from(`${edition.createdAt}|${edition.id}`, "utf8").toString("base64url");
}

/**
 * The gallery: editions on sale that their artists chose to show, from
 * artists who are live and public, newest first, a page at a time. The
 * artist filter is in the query rather than the route so a page is never
 * short because of what was dropped after the fact.
 */
export async function listGalleryEditions(options: { limit?: number; cursor?: string } = {}): Promise<{ editions: EditionRecord[]; nextCursor: string | null }> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
  const after = decodeCursor(options.cursor);
  const afterAt = after ? timeFor(dialect, after.at) : null;

  const rows = (await db
    .select({ edition: schema.editions })
    .from(schema.editions)
    .innerJoin(schema.artists, eq(schema.artists.id, schema.editions.artistId))
    .where(
      and(
        eq(schema.editions.status, "on_sale"),
        eq(schema.editions.inGallery, true),
        eq(schema.artists.status, "live"),
        eq(schema.artists.visibility, "public"),
        after && afterAt !== null
          ? or(
              lt(schema.editions.createdAt, afterAt),
              and(eq(schema.editions.createdAt, afterAt), lt(schema.editions.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(schema.editions.createdAt), desc(schema.editions.id))
    .limit(limit + 1)) as unknown as { edition: EditionRow }[];

  const editions = rows.slice(0, limit).map((row) => buildEdition(row.edition));
  const last = editions[editions.length - 1];
  return { editions, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}


