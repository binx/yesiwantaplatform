import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { OrderStatus } from "../shared/platform.js";
import { getDatabase } from "./client.js";
import { affectedRows, epochOrNull, timeFor, toCount, toEpochMs } from "./repository.js";

/**
 * Postcard orders: one row per paid Stripe invoice under a subscription.
 *
 * Written by the `invoice.paid` webhook and nothing else. The invoice id is
 * unique, so a redelivered event inserts nothing; the row is what a
 * subscriber's receipts page shows and what the admin reconciles payouts
 * against.
 */

export interface OrderRow {
  id: string;
  subscriptionId: string;
  customerId: string;
  artistId: string;
  stripeInvoiceId: string;
  stripePaymentIntentId: string | null;
  status: string;
  amountCents: number;
  refundedCents: number;
  currency: string;
  periodStart: unknown;
  periodEnd: unknown;
  createdAt: unknown;
}

export interface OrderRecord {
  id: string;
  subscriptionId: string;
  customerId: string;
  artistId: string;
  stripeInvoiceId: string;
  stripePaymentIntentId: string | null;
  status: OrderStatus;
  amountCents: number;
  refundedCents: number;
  currency: string;
  periodStart: number | null;
  periodEnd: number | null;
  createdAt: number;
}

export function buildOrder(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    customerId: row.customerId,
    artistId: row.artistId,
    stripeInvoiceId: row.stripeInvoiceId,
    stripePaymentIntentId: row.stripePaymentIntentId,
    status: row.status === "refunded" ? "refunded" : "paid",
    amountCents: row.amountCents,
    refundedCents: row.refundedCents,
    currency: row.currency,
    periodStart: epochOrNull(row.periodStart),
    periodEnd: epochOrNull(row.periodEnd),
    createdAt: toEpochMs(row.createdAt),
  };
}

export interface CreateOrderInput {
  subscriptionId: string;
  customerId: string;
  artistId: string;
  stripeInvoiceId: string;
  stripePaymentIntentId: string | null;
  amountCents: number;
  currency: string;
  /** Epoch milliseconds, from the invoice's line. */
  periodStart: number | null;
  periodEnd: number | null;
}

/** Record a paid invoice. Returns false when that invoice was already recorded. */
export async function recordPaidInvoice(input: CreateOrderInput): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .insert(schema.orders)
    .values({
      id: randomUUID(),
      subscriptionId: input.subscriptionId,
      customerId: input.customerId,
      artistId: input.artistId,
      stripeInvoiceId: input.stripeInvoiceId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      status: "paid",
      amountCents: input.amountCents,
      currency: input.currency,
      periodStart: input.periodStart === null ? null : timeFor(dialect, input.periodStart),
      periodEnd: input.periodEnd === null ? null : timeFor(dialect, input.periodEnd),
    })
    .onConflictDoNothing();
  return affectedRows(result) === 1;
}

export async function findOrderByPaymentIntent(paymentIntentId: string): Promise<OrderRecord | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.stripePaymentIntentId, paymentIntentId))
    .limit(1)) as unknown as OrderRow[];
  const row = rows[0];
  return row ? buildOrder(row) : null;
}

/**
 * Record a refund. Additive, in SQL rather than read-modify-write, so two
 * webhooks landing at once cannot lose one of the amounts. A full refund
 * flips the status.
 */
export async function recordRefund(orderId: string, amountCents: number, full: boolean): Promise<void> {
  if (amountCents <= 0 && !full) return;
  const { drizzle: db, schema } = await getDatabase();
  await db
    .update(schema.orders)
    .set({
      refundedCents: sql`${schema.orders.refundedCents} + ${Math.max(0, amountCents)}`,
      ...(full ? { status: "refunded" } : {}),
    })
    .where(eq(schema.orders.id, orderId));
}

/**
 * How many months each subscription has paid for: its invoices, refunded or
 * not. A refund is the platform's decision about money already taken, not
 * a month the subscriber never had, so it still counts toward the term.
 */
export async function countPaidMonthsForSubscriptions(subscriptionIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (subscriptionIds.length === 0) return map;
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ subscriptionId: schema.orders.subscriptionId, value: count() })
    .from(schema.orders)
    .where(inArray(schema.orders.subscriptionId, [...new Set(subscriptionIds)]))
    .groupBy(schema.orders.subscriptionId)) as unknown as { subscriptionId: string; value: unknown }[];
  for (const row of rows) map.set(row.subscriptionId, toCount(row.value));
  return map;
}

export async function listOrdersForCustomer(customerId: string): Promise<OrderRecord[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.customerId, customerId))
    .orderBy(desc(schema.orders.createdAt), desc(schema.orders.id))) as unknown as OrderRow[];
  return rows.map(buildOrder);
}

export interface OrderPage {
  orders: OrderRecord[];
  total: number;
}

export async function listOrders(options: { artistId?: string; limit?: number; offset?: number } = {}): Promise<OrderPage> {
  const { drizzle: db, schema } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = and(options.artistId ? eq(schema.orders.artistId, options.artistId) : undefined);

  const [rows, totals] = await Promise.all([
    db.select().from(schema.orders).where(where).orderBy(desc(schema.orders.createdAt), desc(schema.orders.id)).limit(limit).offset(offset) as unknown as Promise<OrderRow[]>,
    db.select({ value: count() }).from(schema.orders).where(where) as unknown as Promise<{ value: unknown }[]>,
  ]);
  return { orders: rows.map(buildOrder), total: toCount(totals[0]?.value) };
}

/** Revenue after refunds, all time, for the admin overview. */
export async function sumRevenueCents(): Promise<number> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ value: sql<unknown>`coalesce(sum(${schema.orders.amountCents} - ${schema.orders.refundedCents}), 0)` })
    .from(schema.orders)) as unknown as { value: unknown }[];
  return toCount(rows[0]?.value);
}
