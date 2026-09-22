import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { artistLinkSchema, DEFAULT_TERM_MONTHS, type ArtistLink, type ArtistProfileInput, type ArtistStatus, type ArtistVisibility } from "../shared/platform.js";
import type { Image } from "../shared/schema.js";
import { SlugTakenError } from "./admin-repository.js";
import { getDatabase } from "./client.js";
import { affectedRows, isUniqueViolation, jsonFor, nowFor, parseJson, toBool, toCount, toEpochMs } from "./repository.js";

/**
 * Artists — the people with a page, a price and a queue.
 *
 * Rows leave here as `ArtistRecord`: everything on the row, with the
 * Markdown still Markdown. Rendering happens in the route layer; what a
 * visitor may see is decided there too (`toPublicArtist` in the routes).
 */

export interface ArtistRow {
  id: string;
  customerId: string;
  slug: string;
  name: string;
  tagline: string | null;
  bio: string;
  avatarPath: string | null;
  avatarWidth: number | null;
  avatarHeight: number | null;
  avatarAlt: string | null;
  bannerPath: string | null;
  bannerWidth: number | null;
  bannerHeight: number | null;
  bannerAlt: string | null;
  links: unknown;
  monthlyPriceCents: number;
  termMonths: number;
  sendDay: number;
  status: string;
  visibility: string;
  stripeAccountId: string | null;
  payoutsEnabled: unknown;
  createdAt: unknown;
}

export interface ArtistRecord {
  id: string;
  customerId: string;
  slug: string;
  name: string;
  tagline: string | null;
  bio: string;
  avatar: Image | null;
  banner: Image | null;
  links: ArtistLink[];
  monthlyPriceCents: number;
  termMonths: number;
  sendDay: number;
  status: ArtistStatus;
  visibility: ArtistVisibility;
  stripeAccountId: string | null;
  payoutsEnabled: boolean;
  createdAt: number;
}

function toStatus(value: string): ArtistStatus {
  return value === "live" || value === "paused" ? value : "draft";
}

/** Anything but an explicit "private" shows: an unknown value must not hide cards by accident. */
function toVisibility(value: string): ArtistVisibility {
  return value === "private" ? "private" : "public";
}

/** A stored image, or null when any part of it is missing. */
function toImage(path: string | null, width: number | null, height: number | null, alt: string | null, fallbackAlt: string): Image | null {
  return path && width && height ? { path, width, height, alt: alt ?? fallbackAlt, widths: [] } : null;
}

/** A link that no longer parses is dropped on its own, not with the list: a page must never fail to render over one bad href. */
function toLinks(value: unknown): ArtistLink[] {
  const raw = parseJson<unknown>(value, []);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = artistLinkSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

export function buildArtist(row: ArtistRow): ArtistRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    bio: row.bio,
    avatar: toImage(row.avatarPath, row.avatarWidth, row.avatarHeight, row.avatarAlt, row.name),
    banner: toImage(row.bannerPath, row.bannerWidth, row.bannerHeight, row.bannerAlt, ""),
    links: toLinks(row.links),
    monthlyPriceCents: row.monthlyPriceCents,
    // Clamped like the send day: a hand-edited 0 is still a subscription with an end.
    termMonths: Math.min(24, Math.max(1, row.termMonths || DEFAULT_TERM_MONTHS)),
    // Clamped on the way out too: a hand-edited 31 would never fire in February.
    sendDay: Math.min(28, Math.max(1, row.sendDay)),
    status: toStatus(row.status),
    visibility: toVisibility(row.visibility),
    stripeAccountId: row.stripeAccountId,
    payoutsEnabled: toBool(row.payoutsEnabled),
    createdAt: toEpochMs(row.createdAt),
  };
}

function avatarColumns(avatar: Image | null) {
  return {
    avatarPath: avatar?.path ?? null,
    avatarWidth: avatar?.width ?? null,
    avatarHeight: avatar?.height ?? null,
    avatarAlt: avatar?.alt ?? null,
  };
}

function bannerColumns(banner: Image | null) {
  return {
    bannerPath: banner?.path ?? null,
    bannerWidth: banner?.width ?? null,
    bannerHeight: banner?.height ?? null,
    bannerAlt: banner?.alt ?? null,
  };
}

/** Everything the profile form may set, as columns. Create and update write the same set. */
function profileColumns(dialect: string, input: ArtistProfileInput) {
  return {
    slug: input.slug,
    name: input.name,
    tagline: input.tagline,
    bio: input.bio,
    ...avatarColumns(input.avatar),
    ...bannerColumns(input.banner),
    links: jsonFor(dialect, input.links) as never,
    monthlyPriceCents: input.monthlyPriceCents,
    termMonths: input.termMonths,
    sendDay: input.sendDay,
    visibility: input.visibility,
  };
}

/** Make an artist page for a customer. One per customer; a second attempt is refused by the index. */
export async function createArtist(customerId: string, input: ArtistProfileInput): Promise<ArtistRecord> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const id = randomUUID();

  try {
    await db.insert(schema.artists).values({
      id,
      customerId,
      ...profileColumns(dialect, input),
      status: "draft",
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SlugTakenError(input.slug);
    throw error;
  }

  const created = await getArtist(id);
  if (!created) throw new Error("The artist was not written.");
  return created;
}

export async function updateArtistProfile(id: string, input: ArtistProfileInput): Promise<ArtistRecord> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  try {
    await db
      .update(schema.artists)
      .set({
        ...profileColumns(dialect, input),
        updatedAt: nowFor(dialect),
      })
      .where(eq(schema.artists.id, id));
  } catch (error) {
    if (isUniqueViolation(error)) throw new SlugTakenError(input.slug);
    throw error;
  }

  const updated = await getArtist(id);
  if (!updated) throw new Error("The artist was not written.");
  return updated;
}

export async function setArtistStatus(id: string, status: ArtistStatus): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db.update(schema.artists).set({ status, updatedAt: nowFor(dialect) }).where(eq(schema.artists.id, id));
  return affectedRows(result) === 1;
}

/** Stripe Connect wiring, written by onboarding and by the `account.updated` webhook. */
export async function setArtistStripeAccount(id: string, stripeAccountId: string, payoutsEnabled: boolean): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.artists)
    .set({ stripeAccountId, payoutsEnabled, updatedAt: nowFor(dialect) })
    .where(eq(schema.artists.id, id));
}

async function findOne(where: unknown): Promise<ArtistRecord | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db.select().from(schema.artists).where(where).limit(1)) as unknown as ArtistRow[];
  const row = rows[0];
  return row ? buildArtist(row) : null;
}

export async function getArtist(id: string): Promise<ArtistRecord | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.artists.id, id));
}

export async function findArtistBySlug(slug: string): Promise<ArtistRecord | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.artists.slug, slug));
}

export async function findArtistByCustomer(customerId: string): Promise<ArtistRecord | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.artists.customerId, customerId));
}

export async function findArtistByStripeAccount(stripeAccountId: string): Promise<ArtistRecord | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.artists.stripeAccountId, stripeAccountId));
}

/** Several artists at once, in no particular order. Missing ids are simply absent. */
export async function findArtistsByIds(ids: string[]): Promise<ArtistRecord[]> {
  if (ids.length === 0) return [];
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.artists)
    .where(inArray(schema.artists.id, [...new Set(ids)]))) as unknown as ArtistRow[];
  return rows.map(buildArtist);
}

export interface ArtistListOptions {
  /** Visitors see live artists only; the admin lists everyone. */
  status?: ArtistStatus;
  limit?: number;
  offset?: number;
}

export async function listArtists(options: ArtistListOptions = {}): Promise<{ artists: ArtistRecord[]; total: number }> {
  const { drizzle: db, schema } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = options.status ? eq(schema.artists.status, options.status) : undefined;

  const [rows, totals] = await Promise.all([
    db.select().from(schema.artists).where(where).orderBy(asc(schema.artists.name), asc(schema.artists.id)).limit(limit).offset(offset) as unknown as Promise<ArtistRow[]>,
    db.select({ value: count() }).from(schema.artists).where(where) as unknown as Promise<{ value: unknown }[]>,
  ]);

  return { artists: rows.map(buildArtist), total: toCount(totals[0]?.value) };
}

export interface ArtistCounts {
  /** Subscriptions that are paid up right now. */
  subscribers: number;
  /** Cards accepted by the printer, all time. */
  mailed: number;
}

/** Two grouped queries over many artists, not two per artist. */
export async function countForArtists(artistIds: string[]): Promise<Map<string, ArtistCounts>> {
  const map = new Map<string, ArtistCounts>();
  if (artistIds.length === 0) return map;
  const { drizzle: db, schema } = await getDatabase();
  const ids = [...new Set(artistIds)];
  for (const id of ids) map.set(id, { subscribers: 0, mailed: 0 });

  const subscribers = (await db
    .select({ artistId: schema.subscriptions.artistId, value: count() })
    .from(schema.subscriptions)
    .where(and(inArray(schema.subscriptions.artistId, ids), eq(schema.subscriptions.status, "active")))
    .groupBy(schema.subscriptions.artistId)) as unknown as { artistId: string; value: unknown }[];
  for (const row of subscribers) map.get(row.artistId)!.subscribers = toCount(row.value);

  const mailed = (await db
    .select({ artistId: schema.postcards.artistId, value: count() })
    .from(schema.postcards)
    .where(and(inArray(schema.postcards.artistId, ids), eq(schema.postcards.status, "sent")))
    .groupBy(schema.postcards.artistId)) as unknown as { artistId: string; value: unknown }[];
  for (const row of mailed) map.get(row.artistId)!.mailed = toCount(row.value);

  return map;
}

/** The most recently mailed design of each artist, for a directory tile. */
export async function latestMailedDesignIds(artistIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (artistIds.length === 0) return map;
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ artistId: schema.mailings.artistId, designId: schema.mailings.designId, mailDate: schema.mailings.mailDate })
    .from(schema.mailings)
    .where(and(inArray(schema.mailings.artistId, [...new Set(artistIds)]), eq(schema.mailings.status, "mailed"), eq(schema.mailings.inGallery, true)))
    .orderBy(desc(schema.mailings.mailDate), desc(schema.mailings.id))) as unknown as { artistId: string; designId: string; mailDate: string }[];

  for (const row of rows) if (!map.has(row.artistId)) map.set(row.artistId, row.designId);
  return map;
}

/** For the admin overview: how many artists are in each state. */
export async function countArtistsByStatus(): Promise<Record<string, number>> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ status: schema.artists.status, value: count() })
    .from(schema.artists)
    .groupBy(schema.artists.status)) as unknown as { status: string; value: unknown }[];
  return Object.fromEntries(rows.map((row) => [row.status, toCount(row.value)]));
}

/** Whether a slug is free — for the studio's live check as the artist types. */
export async function slugIsTaken(slug: string, exceptArtistId?: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ id: schema.artists.id })
    .from(schema.artists)
    .where(eq(schema.artists.slug, slug))
    .limit(1)) as unknown as { id: string }[];
  const row = rows[0];
  return row !== undefined && row.id !== exceptArtistId;
}
