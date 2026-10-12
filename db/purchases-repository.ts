import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, sum } from "drizzle-orm";
import type { Cadence, EditionSize, PurchaseStatus } from "../shared/platform.js";
import { recipientSchema, type Recipient } from "../shared/postcards.js";
import { getDatabase } from "./client.js";
import { affectedRows, epochOrNull, jsonFor, nowFor, parseJson, toCount, toEpochMs } from "./repository.js";

/**
 * Purchases: one person collecting one edition, paid for once.
 *
 * Stripe is the authority on payment; the webhook is the only thing that
 * moves a row out of `incomplete`, and the only thing that marks one
 * refunded. What is ours is the address, the start date, and the snapshot
 * of the edition — price, size, cadence — that the ledger and the schedule
 * read.
 */

export interface PurchaseRow {
  id: string;
  customerId: string;
  editionId: string;
  artistId: string;
  status: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  priceCents: number;
  refundedCents: number;
  currency: string;
  cardCount: number;
  cadence: string;
  startDate: string;
  address: unknown;
  paidAt: unknown;
  createdAt: unknown;
}

export interface PurchaseRecord {
  id: string;
  customerId: string;
  editionId: string;
  artistId: string;
  status: PurchaseStatus;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  priceCents: number;
  refundedCents: number;
  currency: string;
  cardCount: EditionSize;
  cadence: Cadence;
  startDate: string;
  address: Recipient;
  paidAt: number | null;
  createdAt: number;
}

function toStatus(value: string): PurchaseStatus {
  return value === "paid" || value === "refunded" ? value : "incomplete";
}

export function buildPurchase(row: PurchaseRow): PurchaseRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    editionId: row.editionId,
    artistId: row.artistId,
    status: toStatus(row.status),
    stripeCheckoutSessionId: row.stripeCheckoutSessionId,
    stripePaymentIntentId: row.stripePaymentIntentId,
    priceCents: row.priceCents,
    refundedCents: row.refundedCents,
    currency: row.currency,
    cardCount: row.cardCount === 12 ? 12 : 6,
    cadence: row.cadence === "twice_monthly" ? "twice_monthly" : "monthly",
    startDate: row.startDate,
    address: recipientSchema.parse(parseJson(row.address, {})),
    paidAt: epochOrNull(row.paidAt),
    createdAt: toEpochMs(row.createdAt),
  };
}

export interface CreatePurchaseInput {
  /** Minted by the caller so it can go into the Stripe session's metadata. */
  id: string;
  customerId: string;
  editionId: string;
  artistId: string;
  checkoutSessionId: string;
  priceCents: number;
  currency: string;
  cardCount: EditionSize;
  cadence: Cadence;
  startDate: string;
  address: Recipient;
}

/** Written as `incomplete` before the collector reaches Stripe. The webhook finishes it. */
export async function createIncompletePurchase(input: CreatePurchaseInput): Promise<PurchaseRecord> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db.insert(schema.purchases).values({
    id: input.id,
    customerId: input.customerId,
    editionId: input.editionId,
    artistId: input.artistId,
    status: "incomplete",
    stripeCheckoutSessionId: input.checkoutSessionId,
    priceCents: input.priceCents,
    currency: input.currency,
    cardCount: input.cardCount,
    cadence: input.cadence,
    startDate: input.startDate,
    address: jsonFor(dialect, input.address) as never,
  });
  const created = await getPurchase(input.id);
  if (!created) throw new Error("The purchase was not written.");
  return created;
}

async function findOne(where: unknown): Promise<PurchaseRecord | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db.select().from(schema.purchases).where(where).limit(1)) as unknown as PurchaseRow[];
  const row = rows[0];
  return row ? buildPurchase(row) : null;
}

export async function getPurchase(id: string): Promise<PurchaseRecord | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.purchases.id, id));
}

/** A purchase, but only if it belongs to this customer: another person's is a 404, not a 403. */
export async function getPurchaseForCustomer(id: string, customerId: string): Promise<PurchaseRecord | null> {
  const { schema } = await getDatabase();
  return findOne(and(eq(schema.purchases.id, id), eq(schema.purchases.customerId, customerId)));
}

export async function findPurchaseByCheckoutSession(sessionId: string): Promise<PurchaseRecord | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.purchases.stripeCheckoutSessionId, sessionId));
}

export async function findPurchaseByPaymentIntent(paymentIntentId: string): Promise<PurchaseRecord | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.purchases.stripePaymentIntentId, paymentIntentId));
}

/**
 * This customer's paid purchase of this edition with cards still to come,
 * if any. One run of an edition at a time: a second would be a double
 * charge far more often than it would be wanted.
 */
export async function findRunningPurchase(customerId: string, editionId: string): Promise<PurchaseRecord | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ purchase: schema.purchases })
    .from(schema.purchases)
    .innerJoin(schema.postcards, eq(schema.postcards.purchaseId, schema.purchases.id))
    .where(
      and(
        eq(schema.purchases.customerId, customerId),
        eq(schema.purchases.editionId, editionId),
        eq(schema.purchases.status, "paid"),
        inArray(schema.postcards.status, ["scheduled", "sending", "error"]),
      ),
    )
    .limit(1)) as unknown as { purchase: PurchaseRow }[];
  const row = rows[0];
  return row ? buildPurchase(row.purchase) : null;
}

const SETTLED: PurchaseStatus[] = ["paid", "refunded"];

async function listWhere(where: unknown): Promise<PurchaseRecord[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.purchases)
    .where(where)
    .orderBy(desc(schema.purchases.createdAt), desc(schema.purchases.id))) as unknown as PurchaseRow[];
  return rows.map(buildPurchase);
}

/** A collector's purchases, newest first. Incomplete rows are abandoned checkouts and left out. */
export async function listPurchasesForCustomer(customerId: string): Promise<PurchaseRecord[]> {
  const { schema } = await getDatabase();
  return listWhere(and(eq(schema.purchases.customerId, customerId), inArray(schema.purchases.status, SETTLED)));
}

/** Everyone who has collected one of an artist's editions, for the studio and the admin. */
export async function listPurchasesForArtist(artistId: string): Promise<PurchaseRecord[]> {
  const { schema } = await getDatabase();
  return listWhere(and(eq(schema.purchases.artistId, artistId), inArray(schema.purchases.status, SETTLED)));
}

export async function listPurchasesForEdition(editionId: string): Promise<PurchaseRecord[]> {
  const { schema } = await getDatabase();
  return listWhere(and(eq(schema.purchases.editionId, editionId), inArray(schema.purchases.status, SETTLED)));
}

export interface PurchasePage {
  purchases: PurchaseRecord[];
  total: number;
}

/** Every purchase on the platform, for the admin. */
export async function listPurchases(options: { status?: PurchaseStatus; limit?: number; offset?: number } = {}): Promise<PurchasePage> {
  const { drizzle: db, schema } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = options.status ? eq(schema.purchases.status, options.status) : inArray(schema.purchases.status, SETTLED);

  const [rows, totals] = await Promise.all([
    db.select().from(schema.purchases).where(where).orderBy(desc(schema.purchases.createdAt), desc(schema.purchases.id)).limit(limit).offset(offset) as unknown as Promise<PurchaseRow[]>,
    db.select({ value: count() }).from(schema.purchases).where(where) as unknown as Promise<{ value: unknown }[]>,
  ]);
  return { purchases: rows.map(buildPurchase), total: toCount(totals[0]?.value) };
}

/** Paid purchases of each of a set of editions: how many people collected it. */
export async function countCollectorsForEditions(editionIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (editionIds.length === 0) return map;
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ editionId: schema.purchases.editionId, value: count() })
    .from(schema.purchases)
    .where(and(inArray(schema.purchases.editionId, [...new Set(editionIds)]), eq(schema.purchases.status, "paid")))
    .groupBy(schema.purchases.editionId)) as unknown as { editionId: string; value: unknown }[];
  for (const row of rows) map.set(row.editionId, toCount(row.value));
  return map;
}

/** Whether anyone has ever paid for this edition. Once they have, it cannot go back to draft. */
export async function editionHasPurchases(editionId: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ value: count() })
    .from(schema.purchases)
    .where(and(eq(schema.purchases.editionId, editionId), inArray(schema.purchases.status, ["incomplete", ...SETTLED])))) as unknown as { value: unknown }[];
  return toCount(rows[0]?.value) > 0;
}

/** For the admin overview. */
export async function countPurchasesByStatus(): Promise<Record<string, number>> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ status: schema.purchases.status, value: count() })
    .from(schema.purchases)
    .groupBy(schema.purchases.status)) as unknown as { status: string; value: unknown }[];
  return Object.fromEntries(rows.map((row) => [row.status, toCount(row.value)]));
}

/** What collectors have paid, less what was given back. */
export async function sumRevenueCents(): Promise<number> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ paid: sum(schema.purchases.priceCents), refunded: sum(schema.purchases.refundedCents) })
    .from(schema.purchases)
    .where(inArray(schema.purchases.status, SETTLED))) as unknown as { paid: unknown; refunded: unknown }[];
  return toCount(rows[0]?.paid) - toCount(rows[0]?.refunded);
}

/* ----------------------------------------------------------------- writes */

/**
 * The webhook's confirmation: Stripe took the money. Only an `incomplete`
 * row moves, so a replayed event cannot un-refund a purchase.
 */
export async function markPurchasePaid(id: string, stripePaymentIntentId: string | null): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.purchases)
    .set({ status: "paid", stripePaymentIntentId, paidAt: nowFor(dialect), updatedAt: nowFor(dialect) })
    .where(and(eq(schema.purchases.id, id), eq(schema.purchases.status, "incomplete")));
  return affectedRows(result) === 1;
}

/** A Checkout that expired unpaid: the row was never anything, so it goes. */
export async function deleteIncompletePurchase(id: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const result = await db
    .delete(schema.purchases)
    .where(and(eq(schema.purchases.id, id), eq(schema.purchases.status, "incomplete")));
  return affectedRows(result) === 1;
}

/**
 * Stripe's running total of what was refunded on the charge. A full refund
 * makes the purchase `refunded`; the caller cancels the cards still to come.
 */
export async function recordPurchaseRefund(id: string, refundedCents: number, full: boolean): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.purchases)
    .set({ refundedCents, ...(full ? { status: "refunded" } : {}), updatedAt: nowFor(dialect) })
    .where(eq(schema.purchases.id, id));
}

/** A collector moved: every purchase not yet refunded takes the new address. Their unsent cards are updated separately. */
export async function updatePurchaseAddresses(customerId: string, address: Recipient): Promise<string[]> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const open = (await db
    .select({ id: schema.purchases.id })
    .from(schema.purchases)
    .where(and(eq(schema.purchases.customerId, customerId), inArray(schema.purchases.status, ["incomplete", "paid"])))) as unknown as { id: string }[];
  if (open.length === 0) return [];
  const ids = open.map((row) => row.id);
  await db
    .update(schema.purchases)
    .set({ address: jsonFor(dialect, address) as never, updatedAt: nowFor(dialect) })
    .where(inArray(schema.purchases.id, ids));
  return ids;
}

/** A fresh id for a purchase, minted before Stripe is asked so it can travel in the session's metadata. */
export function newPurchaseId(): string {
  return randomUUID();
}
