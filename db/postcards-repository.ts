import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { isShownTrackingEvent, type Postcard, type PostcardStatus, type TrackingEvent } from "../shared/postcards.js";
import { getDatabase } from "./client.js";
import { affectedRows, epochOrNull, nowFor, timeFor, toCount, toEpochMs } from "./repository.js";
import type { SubscriptionRecord } from "./subscriptions-repository.js";

/**
 * Postcards — the physical cards, one per subscriber per mailing.
 *
 * Written by the mailing sweep when a mailing's day comes, and worked
 * through by the print sweep, whose conditional `claimPostcard` update is
 * what lets two API instances share one queue without mailing anyone twice.
 */

export interface PostcardRow {
  id: string;
  mailingId: string;
  subscriptionId: string;
  artistId: string;
  designId: string;
  recipientName: string;
  recipientLine1: string;
  recipientLine2: string | null;
  recipientCity: string;
  recipientState: string;
  recipientPostalCode: string;
  recipientCountry: string;
  mailDate: string;
  status: string;
  lobId: string | null;
  lobUrl: string | null;
  expectedDeliveryDate: string | null;
  sentAt: unknown;
  attempts: number;
  lastError: string | null;
  trackingStatus: string | null;
  createdAt: unknown;
}

interface TrackingRow {
  id: string;
  postcardId: string;
  type: string;
  occurredAt: unknown;
  location: string | null;
}

export function buildPostcard(row: PostcardRow, tracking: TrackingEvent[] = []): Postcard {
  return {
    id: row.id,
    designId: row.designId,
    subscriptionId: row.subscriptionId,
    recipient: {
      name: row.recipientName,
      line1: row.recipientLine1,
      line2: row.recipientLine2,
      city: row.recipientCity,
      state: row.recipientState,
      postalCode: row.recipientPostalCode,
      country: row.recipientCountry,
    },
    mailDate: row.mailDate,
    status: row.status as PostcardStatus,
    lobId: row.lobId,
    lobUrl: row.lobUrl,
    expectedDeliveryDate: row.expectedDeliveryDate,
    sentAt: epochOrNull(row.sentAt),
    attempts: row.attempts,
    lastError: row.lastError,
    trackingStatus: row.trackingStatus,
    tracking,
  };
}

/** The row plus what the postcard row alone does not say: which mailing and artist. */
export interface PostcardWithContext extends Postcard {
  mailingId: string;
  artistId: string;
  createdAt: number;
}

export function buildPostcardWithContext(row: PostcardRow, tracking: TrackingEvent[] = []): PostcardWithContext {
  return { ...buildPostcard(row, tracking), mailingId: row.mailingId, artistId: row.artistId, createdAt: toEpochMs(row.createdAt) };
}

/**
 * Write one card per subscription for a mailing.
 *
 * The unique index on (mailing, subscription) makes this idempotent: a sweep
 * that crashed halfway and ran again inserts what is missing and skips what
 * is there. Chunked so a large subscriber list does not build one enormous
 * statement.
 */
export async function materialisePostcards(
  mailing: { id: string; artistId: string; designId: string; mailDate: string },
  subscriptions: SubscriptionRecord[],
): Promise<number> {
  if (subscriptions.length === 0) return 0;
  const { drizzle: db, schema } = await getDatabase();
  let written = 0;

  for (let start = 0; start < subscriptions.length; start += 200) {
    const chunk = subscriptions.slice(start, start + 200);
    const values = chunk.map((subscription) => ({
      id: randomUUID(),
      mailingId: mailing.id,
      subscriptionId: subscription.id,
      artistId: mailing.artistId,
      designId: mailing.designId,
      recipientName: subscription.address.name,
      recipientLine1: subscription.address.line1,
      recipientLine2: subscription.address.line2,
      recipientCity: subscription.address.city,
      recipientState: subscription.address.state,
      recipientPostalCode: subscription.address.postalCode,
      recipientCountry: subscription.address.country,
      mailDate: mailing.mailDate,
      status: "scheduled",
    }));
    const result = await db.insert(schema.postcards).values(values).onConflictDoNothing();
    written += affectedRows(result);
  }
  return written;
}

/* ----------------------------------------------------------------- reads */

/** The shown tracking events for a set of cards, oldest first, one query rather than one per card. */
export async function loadTracking(postcardIds: string[]): Promise<Map<string, TrackingEvent[]>> {
  const { drizzle: db, schema } = await getDatabase();
  const map = new Map<string, TrackingEvent[]>();
  if (postcardIds.length === 0) return map;

  const rows: TrackingRow[] = [];
  for (let start = 0; start < postcardIds.length; start += 500) {
    rows.push(
      ...((await db
        .select()
        .from(schema.postcardTrackingEvents)
        .where(inArray(schema.postcardTrackingEvents.postcardId, postcardIds.slice(start, start + 500)))
        .orderBy(asc(schema.postcardTrackingEvents.occurredAt), asc(schema.postcardTrackingEvents.id))) as unknown as TrackingRow[]),
    );
  }

  for (const row of rows) {
    if (!isShownTrackingEvent(row.type)) continue;
    const event: TrackingEvent = { type: row.type, occurredAt: toEpochMs(row.occurredAt), location: row.location };
    const list = map.get(row.postcardId);
    if (list) list.push(event);
    else map.set(row.postcardId, [event]);
  }
  return map;
}

async function withTracking(rows: PostcardRow[]): Promise<PostcardWithContext[]> {
  const tracking = await loadTracking(rows.map((row) => row.id));
  return rows.map((row) => buildPostcardWithContext(row, tracking.get(row.id) ?? []));
}

export async function getPostcard(id: string): Promise<PostcardWithContext | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db.select().from(schema.postcards).where(eq(schema.postcards.id, id)).limit(1)) as unknown as PostcardRow[];
  const [card] = await withTracking(rows);
  return card ?? null;
}

/** Every card on a mailing, by recipient name. The scope an artist or admin acts within. */
export async function listPostcardsForMailing(mailingId: string): Promise<PostcardWithContext[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.postcards)
    .where(eq(schema.postcards.mailingId, mailingId))
    .orderBy(asc(schema.postcards.recipientName), asc(schema.postcards.id))) as unknown as PostcardRow[];
  return withTracking(rows);
}

/** Every card mailed to this customer, newest first — across all their subscriptions. */
export async function listPostcardsForCustomer(customerId: string): Promise<PostcardWithContext[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ postcard: schema.postcards })
    .from(schema.postcards)
    .innerJoin(schema.subscriptions, eq(schema.subscriptions.id, schema.postcards.subscriptionId))
    .where(eq(schema.subscriptions.customerId, customerId))
    .orderBy(desc(schema.postcards.mailDate), desc(schema.postcards.id))) as unknown as { postcard: PostcardRow }[];
  return withTracking(rows.map((row) => row.postcard));
}

/** Cards in a state, newest first — the admin's "needs attention" list. */
export async function listPostcardsByStatus(status: PostcardStatus, limit = 100): Promise<PostcardWithContext[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.postcards)
    .where(eq(schema.postcards.status, status))
    .orderBy(desc(schema.postcards.mailDate), desc(schema.postcards.id))
    .limit(limit)) as unknown as PostcardRow[];
  return withTracking(rows);
}

/* ----------------------------------------------------------------- sweep */

/** Cards due to go to Lob: scheduled, with a mail date on or before `today`. */
export async function findDuePostcards(today: string, limit: number): Promise<PostcardRow[]> {
  const { drizzle: db, schema } = await getDatabase();
  return (await db
    .select()
    .from(schema.postcards)
    .where(and(eq(schema.postcards.status, "scheduled"), lte(schema.postcards.mailDate, today)))
    .orderBy(asc(schema.postcards.mailDate), asc(schema.postcards.id))
    .limit(limit)) as unknown as PostcardRow[];
}

/**
 * Claim a card for sending — the guard that makes two API instances send one
 * card. `UPDATE ... WHERE status = 'scheduled'` means only the first of two
 * racing claims can ever win.
 */
export async function claimPostcard(id: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.postcards)
    .set({ status: "sending", attempts: sql`${schema.postcards.attempts} + 1`, updatedAt: nowFor(dialect) })
    .where(and(eq(schema.postcards.id, id), eq(schema.postcards.status, "scheduled")));
  return affectedRows(result) === 1;
}

/** Cards a crashed sweep left claimed. Put back so the next sweep retries them. */
export async function releaseStalePostcards(olderThan: Date): Promise<number> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.postcards)
    .set({ status: "scheduled" })
    .where(and(eq(schema.postcards.status, "sending"), lte(schema.postcards.updatedAt, timeFor(dialect, olderThan.getTime()))));
  return affectedRows(result);
}

export async function markPostcardSent(id: string, lob: { id: string; url: string | null; expectedDeliveryDate: string | null }): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.postcards)
    .set({
      status: "sent",
      lobId: lob.id,
      lobUrl: lob.url,
      expectedDeliveryDate: lob.expectedDeliveryDate,
      sentAt: nowFor(dialect),
      lastError: null,
      updatedAt: nowFor(dialect),
    })
    .where(eq(schema.postcards.id, id));
}

/**
 * A send that did not happen.
 *
 * `retry` puts the card back to `scheduled` so the next sweep tries again —
 * for a rate limit, a network blip, a 5xx. `error` parks it for a person:
 * Lob refused the card, and the reason is stored in Lob's own words.
 */
export async function markPostcardFailed(id: string, message: string, outcome: "retry" | "error"): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.postcards)
    .set({ status: outcome === "retry" ? "scheduled" : "error", lastError: message.slice(0, 2000), updatedAt: nowFor(dialect) })
    .where(eq(schema.postcards.id, id));
}

/**
 * Put a claimed card back untouched, for a failure that was Lob's or the
 * network's rather than the card's. The claim's `attempts + 1` is undone, so
 * an hour of throttling cannot park a card nobody needs to fix.
 */
export async function releasePostcard(id: string, message: string): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.postcards)
    .set({
      status: "scheduled",
      attempts: sql`CASE WHEN ${schema.postcards.attempts} > 0 THEN ${schema.postcards.attempts} - 1 ELSE 0 END`,
      lastError: message.slice(0, 2000),
      updatedAt: nowFor(dialect),
    })
    .where(and(eq(schema.postcards.id, id), eq(schema.postcards.status, "sending")));
}

/** Put an errored (or cancelled) card back on the schedule. Returns false if it was not one. */
export async function requeuePostcard(id: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.postcards)
    .set({ status: "scheduled", lastError: null, attempts: 0, updatedAt: nowFor(dialect) })
    .where(and(eq(schema.postcards.id, id), inArray(schema.postcards.status, ["error", "cancelled"])));
  return affectedRows(result) === 1;
}

/** Withdraw one card that has not gone out. Returns false if it already had. */
export async function cancelPostcard(id: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.postcards)
    .set({ status: "cancelled", updatedAt: nowFor(dialect) })
    .where(and(eq(schema.postcards.id, id), inArray(schema.postcards.status, ["scheduled", "error"])));
  return affectedRows(result) === 1;
}

/* -------------------------------------------------------------- tracking */

/** The card a Lob tracking event is about: by our id from the metadata, else by Lob's own id. */
export async function findPostcardForTracking(ours: string | null, lobId: string | null): Promise<PostcardRow | null> {
  const { drizzle: db, schema } = await getDatabase();

  if (ours) {
    const rows = (await db.select().from(schema.postcards).where(eq(schema.postcards.id, ours)).limit(1)) as unknown as PostcardRow[];
    if (rows[0]) return rows[0];
  }
  if (lobId) {
    const rows = (await db.select().from(schema.postcards).where(eq(schema.postcards.lobId, lobId)).limit(1)) as unknown as PostcardRow[];
    if (rows[0]) return rows[0];
  }
  return null;
}

export interface TrackingEventInput {
  /** Lob's event id. */
  id: string;
  type: string;
  /** Epoch milliseconds. */
  occurredAt: number;
  location: string | null;
}

/**
 * Record one tracking event and move the card's status forward.
 *
 * The event id is the primary key, so Lob delivering twice inserts once.
 * The status only ever moves to a *later* shown event — USPS scans arrive
 * out of order often enough that "delivered, then in transit" would
 * otherwise read as a card going backwards.
 */
export async function recordTrackingEvent(postcardId: string, event: TrackingEventInput): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const seen = (await db
    .select({ id: schema.postcardTrackingEvents.id })
    .from(schema.postcardTrackingEvents)
    .where(eq(schema.postcardTrackingEvents.id, event.id))
    .limit(1)) as unknown as { id: string }[];
  if (seen.length > 0) return false;

  await db.insert(schema.postcardTrackingEvents).values({
    id: event.id,
    postcardId,
    type: event.type,
    occurredAt: timeFor(dialect, event.occurredAt),
    location: event.location,
  });

  if (isShownTrackingEvent(event.type)) {
    const shown = (await loadTracking([postcardId])).get(postcardId) ?? [];
    const latest = shown[shown.length - 1];
    if (latest) {
      await db.update(schema.postcards).set({ trackingStatus: latest.type, updatedAt: nowFor(dialect) }).where(eq(schema.postcards.id, postcardId));
    }
  }
  return true;
}

/** USPS sent the card back. The status stays `sent` — it was — but the admin's error column says so. */
export async function markPostcardReturned(postcardId: string): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.postcards)
    .set({ lastError: "Returned to sender by USPS. Check the address.", updatedAt: nowFor(dialect) })
    .where(eq(schema.postcards.id, postcardId));
}

/* ---------------------------------------------------------------- counts */

/** For the admin overview: how many cards are in each state right now. */
export async function countPostcardsByStatus(): Promise<Record<string, number>> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ status: schema.postcards.status, value: count() })
    .from(schema.postcards)
    .groupBy(schema.postcards.status)) as unknown as { status: string; value: unknown }[];
  return Object.fromEntries(rows.map((row) => [row.status, toCount(row.value)]));
}
