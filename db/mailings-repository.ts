import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, lte, or, lt } from "drizzle-orm";
import type { MailingStatus } from "../shared/platform.js";
import { periodOf } from "../shared/platform.js";
import { getDatabase } from "./client.js";
import { affectedRows, epochOrNull, isUniqueViolation, nowFor, toBool, toCount, toEpochMs } from "./repository.js";

/**
 * Mailings: an artist's queue, and the record of what went out when.
 *
 * The unique index on (artist, period) is what enforces one card a month —
 * see the schema for why — and it surfaces here as `PeriodTakenError`, which
 * the studio turns into a sentence the artist can act on.
 */

export interface MailingRow {
  id: string;
  artistId: string;
  designId: string;
  title: string | null;
  mailDate: string;
  period: string;
  status: string;
  inGallery: unknown;
  subscriberCount: number;
  mailedAt: unknown;
  createdAt: unknown;
}

export interface MailingRecord {
  id: string;
  artistId: string;
  designId: string;
  title: string | null;
  mailDate: string;
  period: string;
  status: MailingStatus;
  inGallery: boolean;
  subscriberCount: number;
  mailedAt: number | null;
  createdAt: number;
}

export class PeriodTakenError extends Error {
  constructor(period: string) {
    super(`A postcard is already scheduled for ${period}. One card goes out a month; pick another month or move that one.`);
    this.name = "PeriodTakenError";
  }
}

function toStatus(value: string): MailingStatus {
  return value === "mailed" || value === "cancelled" ? value : "queued";
}

export function buildMailing(row: MailingRow): MailingRecord {
  return {
    id: row.id,
    artistId: row.artistId,
    designId: row.designId,
    title: row.title,
    mailDate: row.mailDate,
    period: row.period,
    status: toStatus(row.status),
    inGallery: toBool(row.inGallery),
    subscriberCount: row.subscriberCount,
    mailedAt: epochOrNull(row.mailedAt),
    createdAt: toEpochMs(row.createdAt),
  };
}

export interface CreateMailingInput {
  artistId: string;
  designId: string;
  mailDate: string;
  title: string | null;
  inGallery: boolean;
}

export async function createMailing(input: CreateMailingInput, id = randomUUID()): Promise<MailingRecord> {
  const { drizzle: db, schema } = await getDatabase();
  const period = periodOf(input.mailDate);

  try {
    await db.insert(schema.mailings).values({
      id,
      artistId: input.artistId,
      designId: input.designId,
      title: input.title,
      mailDate: input.mailDate,
      period,
      status: "queued",
      inGallery: input.inGallery,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PeriodTakenError(period);
    throw error;
  }

  const created = await getMailing(id);
  if (!created) throw new Error("The mailing was not written.");
  return created;
}

/** Change a queued mailing's date, title or gallery flag. Returns false once it has gone. */
export async function updateQueuedMailing(
  id: string,
  artistId: string,
  input: { mailDate: string; title: string | null; inGallery: boolean },
): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const period = periodOf(input.mailDate);

  try {
    const result = await db
      .update(schema.mailings)
      .set({ mailDate: input.mailDate, period, title: input.title, inGallery: input.inGallery, updatedAt: nowFor(dialect) })
      .where(and(eq(schema.mailings.id, id), eq(schema.mailings.artistId, artistId), eq(schema.mailings.status, "queued")));
    return affectedRows(result) === 1;
  } catch (error) {
    if (isUniqueViolation(error)) throw new PeriodTakenError(period);
    throw error;
  }
}

/** Only the gallery flag — allowed after mailing too, since it is about showing, not sending. */
export async function setMailingInGallery(id: string, artistId: string, inGallery: boolean): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.mailings)
    .set({ inGallery, updatedAt: nowFor(dialect) })
    .where(and(eq(schema.mailings.id, id), eq(schema.mailings.artistId, artistId)));
  return affectedRows(result) === 1;
}

/**
 * Withdraw a queued mailing.
 *
 * Deleted rather than marked, so the month is free again for another card —
 * a cancelled row would still hold the (artist, period) index. The `queued`
 * condition is what keeps a mailing that has gone out from disappearing.
 */
export async function cancelQueuedMailing(id: string, artistId: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const result = await db
    .delete(schema.mailings)
    .where(and(eq(schema.mailings.id, id), eq(schema.mailings.artistId, artistId), eq(schema.mailings.status, "queued")));
  return affectedRows(result) === 1;
}

async function findOne(where: unknown): Promise<MailingRecord | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db.select().from(schema.mailings).where(where).limit(1)) as unknown as MailingRow[];
  const row = rows[0];
  return row ? buildMailing(row) : null;
}

export async function getMailing(id: string): Promise<MailingRecord | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.mailings.id, id));
}

export async function getMailingForArtist(id: string, artistId: string): Promise<MailingRecord | null> {
  const { schema } = await getDatabase();
  return findOne(and(eq(schema.mailings.id, id), eq(schema.mailings.artistId, artistId)));
}

/** An artist's mailings, soonest first for the queue and most recent first for the past. */
export async function listMailingsForArtist(artistId: string): Promise<MailingRecord[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.mailings)
    .where(eq(schema.mailings.artistId, artistId))
    .orderBy(desc(schema.mailings.mailDate), desc(schema.mailings.id))) as unknown as MailingRow[];
  return rows.map(buildMailing);
}

/** The mail dates this artist has already taken, for the "next free month" suggestion. */
export async function takenMailDates(artistId: string): Promise<string[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ mailDate: schema.mailings.mailDate })
    .from(schema.mailings)
    .where(eq(schema.mailings.artistId, artistId))) as unknown as { mailDate: string }[];
  return rows.map((row) => row.mailDate);
}

/** Mailings whose day has come: queued, with a mail date on or before `today`. */
export async function findDueMailings(today: string, limit: number): Promise<MailingRecord[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.mailings)
    .where(and(eq(schema.mailings.status, "queued"), lte(schema.mailings.mailDate, today)))
    .orderBy(asc(schema.mailings.mailDate), asc(schema.mailings.id))
    .limit(limit)) as unknown as MailingRow[];
  return rows.map(buildMailing);
}

/**
 * Mark a mailing as gone, recording how many cards were written. Conditional
 * on `queued`, so the sweep's claim is the one write that decides who
 * materialises a mailing when two instances tick at once.
 */
export async function markMailingMailed(id: string, subscriberCount: number): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.mailings)
    .set({ status: "mailed", subscriberCount, mailedAt: nowFor(dialect), updatedAt: nowFor(dialect) })
    .where(and(eq(schema.mailings.id, id), eq(schema.mailings.status, "queued")));
  return affectedRows(result) === 1;
}

/** Where a mailing's cards are, for the studio's queue and the admin's list. */
export interface MailingCounts {
  scheduled: number;
  sent: number;
  error: number;
  cancelled: number;
}

const EMPTY: MailingCounts = { scheduled: 0, sent: 0, error: 0, cancelled: 0 };

export async function countPostcardsByMailing(mailingIds: string[]): Promise<Map<string, MailingCounts>> {
  const map = new Map<string, MailingCounts>();
  if (mailingIds.length === 0) return map;
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ mailingId: schema.postcards.mailingId, status: schema.postcards.status, value: count() })
    .from(schema.postcards)
    .where(inArray(schema.postcards.mailingId, [...new Set(mailingIds)]))
    .groupBy(schema.postcards.mailingId, schema.postcards.status)) as unknown as { mailingId: string; status: string; value: unknown }[];

  for (const row of rows) {
    const counts = map.get(row.mailingId) ?? { ...EMPTY };
    const n = toCount(row.value);
    if (row.status === "scheduled" || row.status === "sending") counts.scheduled += n;
    else if (row.status === "sent") counts.sent += n;
    else if (row.status === "error") counts.error += n;
    else if (row.status === "cancelled") counts.cancelled += n;
    map.set(row.mailingId, counts);
  }
  return map;
}

export interface MailingPage {
  mailings: MailingRecord[];
  total: number;
}

/** Every mailing on the platform, for the admin. */
export async function listMailings(options: { status?: MailingStatus; limit?: number; offset?: number } = {}): Promise<MailingPage> {
  const { drizzle: db, schema } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = options.status ? eq(schema.mailings.status, options.status) : undefined;

  const [rows, totals] = await Promise.all([
    db.select().from(schema.mailings).where(where).orderBy(desc(schema.mailings.mailDate), desc(schema.mailings.id)).limit(limit).offset(offset) as unknown as Promise<MailingRow[]>,
    db.select({ value: count() }).from(schema.mailings).where(where) as unknown as Promise<{ value: unknown }[]>,
  ]);
  return { mailings: rows.map(buildMailing), total: toCount(totals[0]?.value) };
}

/* ---------------------------------------------------------------- gallery */

/** A cursor is the last row's mail date and id, so a page is stable while mailings keep going out. */
function decodeCursor(cursor: string | undefined): { mailDate: string; id: string } | null {
  if (!cursor) return null;
  const [mailDate, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  return mailDate && id ? { mailDate, id } : null;
}

function encodeCursor(mailing: MailingRecord): string {
  return Buffer.from(`${mailing.mailDate}|${mailing.id}`, "utf8").toString("base64url");
}

/**
 * Mailed cards their artists chose to show, newest first, a page at a time.
 * Filtered to live artists in the route, since a paused artist's past cards
 * are still theirs to show.
 */
export async function listGalleryMailings(options: { limit?: number; cursor?: string; artistId?: string } = {}): Promise<{ mailings: MailingRecord[]; nextCursor: string | null }> {
  const { drizzle: db, schema } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
  const after = decodeCursor(options.cursor);

  const rows = (await db
    .select()
    .from(schema.mailings)
    .where(
      and(
        eq(schema.mailings.status, "mailed"),
        eq(schema.mailings.inGallery, true),
        options.artistId ? eq(schema.mailings.artistId, options.artistId) : undefined,
        after
          ? or(
              lt(schema.mailings.mailDate, after.mailDate),
              and(eq(schema.mailings.mailDate, after.mailDate), lt(schema.mailings.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(schema.mailings.mailDate), desc(schema.mailings.id))
    .limit(limit + 1)) as unknown as MailingRow[];

  const page = rows.slice(0, limit).map(buildMailing);
  const last = page[page.length - 1];
  return { mailings: page, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}

/** For the admin overview. */
export async function countMailingsByStatus(): Promise<Record<string, number>> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ status: schema.mailings.status, value: count() })
    .from(schema.mailings)
    .groupBy(schema.mailings.status)) as unknown as { status: string; value: unknown }[];
  return Object.fromEntries(rows.map((row) => [row.status, toCount(row.value)]));
}
