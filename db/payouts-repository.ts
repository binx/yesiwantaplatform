import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { PayoutStatus } from "../shared/platform.js";
import { getDatabase } from "./client.js";
import { affectedRows, epochOrNull, nowFor, timeFor, toCount, toEpochMs } from "./repository.js";

/**
 * The payout ledger: what each sent card earned its artist.
 *
 * One row per sent postcard, unique on the postcard, written the moment Lob
 * accepts it with the numbers as they were then. The payout sweep works
 * through `pending` rows for artists whose Stripe account can take a
 * transfer; the same claim-then-act pattern as the print sweep keeps two
 * instances from paying one card twice, and the row id is Stripe's
 * idempotency key as a second guard.
 */

export interface PayoutRow {
  id: string;
  artistId: string;
  postcardId: string;
  mailingId: string;
  grossCents: number;
  printCostCents: number;
  platformFeeCents: number;
  amountCents: number;
  currency: string;
  status: string;
  stripeTransferId: string | null;
  attempts: number;
  lastError: string | null;
  paidAt: unknown;
  createdAt: unknown;
}

export interface PayoutRecord {
  id: string;
  artistId: string;
  postcardId: string;
  mailingId: string;
  grossCents: number;
  printCostCents: number;
  platformFeeCents: number;
  amountCents: number;
  currency: string;
  status: PayoutStatus;
  stripeTransferId: string | null;
  attempts: number;
  lastError: string | null;
  paidAt: number | null;
  createdAt: number;
}

function toStatus(value: string): PayoutStatus {
  return value === "paid" || value === "failed" ? value : "pending";
}

export function buildPayout(row: PayoutRow): PayoutRecord {
  return {
    id: row.id,
    artistId: row.artistId,
    postcardId: row.postcardId,
    mailingId: row.mailingId,
    grossCents: row.grossCents,
    printCostCents: row.printCostCents,
    platformFeeCents: row.platformFeeCents,
    amountCents: row.amountCents,
    currency: row.currency,
    status: toStatus(row.status),
    stripeTransferId: row.stripeTransferId,
    attempts: row.attempts,
    lastError: row.lastError,
    paidAt: epochOrNull(row.paidAt),
    createdAt: toEpochMs(row.createdAt),
  };
}

export interface CreatePayoutInput {
  artistId: string;
  postcardId: string;
  mailingId: string;
  grossCents: number;
  printCostCents: number;
  platformFeeCents: number;
  amountCents: number;
  currency: string;
}

/** Record what a sent card earned. A second call for the same card inserts nothing. */
export async function recordEarning(input: CreatePayoutInput): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const result = await db
    .insert(schema.payouts)
    .values({
      id: randomUUID(),
      artistId: input.artistId,
      postcardId: input.postcardId,
      mailingId: input.mailingId,
      grossCents: input.grossCents,
      printCostCents: input.printCostCents,
      platformFeeCents: input.platformFeeCents,
      amountCents: input.amountCents,
      currency: input.currency,
      // Nothing to transfer is settled on the spot, and never troubles the sweep.
      status: input.amountCents > 0 ? "pending" : "paid",
    })
    .onConflictDoNothing();
  return affectedRows(result) === 1;
}

export async function getPayout(id: string): Promise<PayoutRecord | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db.select().from(schema.payouts).where(eq(schema.payouts.id, id)).limit(1)) as unknown as PayoutRow[];
  const row = rows[0];
  return row ? buildPayout(row) : null;
}

export async function listPayoutsForArtist(artistId: string, limit = 200): Promise<PayoutRecord[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.payouts)
    .where(eq(schema.payouts.artistId, artistId))
    .orderBy(desc(schema.payouts.createdAt), desc(schema.payouts.id))
    .limit(limit)) as unknown as PayoutRow[];
  return rows.map(buildPayout);
}

export interface PayoutPage {
  payouts: PayoutRecord[];
  total: number;
}

export async function listPayouts(options: { status?: PayoutStatus; limit?: number; offset?: number } = {}): Promise<PayoutPage> {
  const { drizzle: db, schema } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = options.status ? eq(schema.payouts.status, options.status) : undefined;

  const [rows, totals] = await Promise.all([
    db.select().from(schema.payouts).where(where).orderBy(desc(schema.payouts.createdAt), desc(schema.payouts.id)).limit(limit).offset(offset) as unknown as Promise<PayoutRow[]>,
    db.select({ value: count() }).from(schema.payouts).where(where) as unknown as Promise<{ value: unknown }[]>,
  ]);
  return { payouts: rows.map(buildPayout), total: toCount(totals[0]?.value) };
}

export interface EarningsTotals {
  pendingCents: number;
  paidCents: number;
}

/** Pending and paid, summed, for one artist. */
export async function sumEarningsForArtist(artistId: string): Promise<EarningsTotals> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ status: schema.payouts.status, value: sql<unknown>`coalesce(sum(${schema.payouts.amountCents}), 0)` })
    .from(schema.payouts)
    .where(eq(schema.payouts.artistId, artistId))
    .groupBy(schema.payouts.status)) as unknown as { status: string; value: unknown }[];
  const totals = { pendingCents: 0, paidCents: 0 };
  for (const row of rows) {
    if (row.status === "paid") totals.paidCents += toCount(row.value);
    else if (row.status === "pending" || row.status === "failed") totals.pendingCents += toCount(row.value);
  }
  return totals;
}

/** The same, for the whole platform: what is owed and what has gone out. */
export async function sumPayoutsByStatus(): Promise<Record<string, number>> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ status: schema.payouts.status, value: sql<unknown>`coalesce(sum(${schema.payouts.amountCents}), 0)` })
    .from(schema.payouts)
    .groupBy(schema.payouts.status)) as unknown as { status: string; value: unknown }[];
  return Object.fromEntries(rows.map((row) => [row.status, toCount(row.value)]));
}

/* ----------------------------------------------------------------- sweep */

/**
 * Pending payouts whose artist can be paid: a Stripe account that has
 * finished onboarding. Rows for artists still onboarding accrue and are
 * simply not returned; the day they finish, the next sweep picks them up.
 */
export async function findPayablePayouts(limit: number): Promise<PayoutRecord[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ payout: schema.payouts })
    .from(schema.payouts)
    .innerJoin(schema.artists, eq(schema.artists.id, schema.payouts.artistId))
    .where(and(eq(schema.payouts.status, "pending"), eq(schema.artists.payoutsEnabled, true), lte(schema.payouts.attempts, 8)))
    .orderBy(desc(schema.payouts.createdAt))
    .limit(limit)) as unknown as { payout: PayoutRow }[];
  return rows.map((row) => buildPayout(row.payout));
}

/** Claim a payout for transfer: `pending` → `sending`, the same guard as the print sweep's. */
export async function claimPayout(id: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.payouts)
    .set({ status: "sending", attempts: sql`${schema.payouts.attempts} + 1`, updatedAt: nowFor(dialect) })
    .where(and(eq(schema.payouts.id, id), eq(schema.payouts.status, "pending")));
  return affectedRows(result) === 1;
}

/** Claims a crashed sweep left behind, put back. */
export async function releaseStalePayouts(olderThan: Date): Promise<number> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.payouts)
    .set({ status: "pending" })
    .where(and(eq(schema.payouts.status, "sending"), lte(schema.payouts.updatedAt, timeFor(dialect, olderThan.getTime()))));
  return affectedRows(result);
}

export async function markPayoutPaid(id: string, stripeTransferId: string): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.payouts)
    .set({ status: "paid", stripeTransferId, lastError: null, paidAt: nowFor(dialect), updatedAt: nowFor(dialect) })
    .where(eq(schema.payouts.id, id));
}

/** `retry` puts it back for the next sweep; `failed` parks it for the admin with Stripe's reason. */
export async function markPayoutFailed(id: string, message: string, outcome: "retry" | "failed"): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.payouts)
    .set({ status: outcome === "retry" ? "pending" : "failed", lastError: message.slice(0, 2000), updatedAt: nowFor(dialect) })
    .where(eq(schema.payouts.id, id));
}

/** The admin's retry: a failed payout back to pending, attempts reset. */
export async function requeuePayout(id: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.payouts)
    .set({ status: "pending", attempts: 0, lastError: null, updatedAt: nowFor(dialect) })
    .where(and(eq(schema.payouts.id, id), inArray(schema.payouts.status, ["failed", "pending"])));
  return affectedRows(result) === 1;
}
