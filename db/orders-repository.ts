import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { orderReference, orderSchema, type Order, type OrderStatus } from "../shared/orders.js";
import { countPostcardsByDestination, type CartLine } from "../shared/cart.js";
import type { Postcard, PostcardStatus } from "../shared/postcards.js";
import { getDatabase } from "./client.js";
import { affectedRows, findDesignsByIds, toPublicDesign } from "./designs-repository.js";
import { nowFor, toEpochMs } from "./repository.js";

/**
 * Orders and the postcards on them.
 *
 * Stripe is still the authority on payment; fulfilment — which card goes to
 * Lob on which day, and whether it did — is entirely ours.
 */

export interface CreatePendingOrderInput {
  /** Minted by the caller so it can go into the Stripe session's metadata. */
  id: string;
  checkoutSessionId: string;
  email: string;
  currency: string;
  unitPriceCents: number;
  /** What a card mailed abroad costs. Null when the cart has none, or the shop is US-only. */
  internationalUnitPriceCents?: number | null;
  /** The cart, validated: every design id already checked against the table. */
  lines: CartLine[];
  /** Set only when the buyer was signed in at checkout. Null for a guest. */
  customerId?: string | null;
}

/**
 * Record an order and its postcards before the buyer reaches Stripe.
 *
 * Postcards are written now, as `pending`, rather than reconstructed from the
 * cart later: the webhook that confirms payment gets a Stripe session and an
 * order id, and nothing else — so everything it needs to schedule has to be
 * here already.
 */
export async function createPendingOrder(input: CreatePendingOrderInput): Promise<string> {
  const { drizzle: db, schema } = await getDatabase();

  const { domestic, international } = countPostcardsByDestination(input.lines);
  const postcardCount = domestic + international;
  const internationalUnitPriceCents = international > 0 ? (input.internationalUnitPriceCents ?? null) : null;
  if (international > 0 && internationalUnitPriceCents === null) {
    throw new Error("An order with international postcards needs an international price.");
  }

  const subtotalCents = domestic * input.unitPriceCents + international * (internationalUnitPriceCents ?? 0);

  await db.insert(schema.orders).values({
    id: input.id,
    stripeCheckoutSessionId: input.checkoutSessionId,
    email: input.email,
    status: "pending",
    currency: input.currency,
    unitPriceCents: input.unitPriceCents,
    postcardCount,
    internationalCount: international,
    internationalUnitPriceCents,
    subtotalCents,
    totalCents: subtotalCents,
    customerId: input.customerId ?? null,
  });

  for (const [batchIndex, line] of input.lines.entries()) {
    for (const design of line.designs) {
      for (const recipient of line.recipients) {
        await db.insert(schema.postcards).values({
          id: randomUUID(),
          orderId: input.id,
          designId: design.designId,
          batchIndex,
          recipientName: recipient.name,
          recipientLine1: recipient.line1,
          recipientLine2: recipient.line2,
          recipientCity: recipient.city,
          recipientState: recipient.state,
          recipientPostalCode: recipient.postalCode,
          recipientCountry: recipient.country,
          mailDate: design.mailDate,
          status: "pending",
        });
      }
    }
  }

  return input.id;
}

interface OrderRow {
  id: string;
  stripeCheckoutSessionId: string;
  email: string;
  status: string;
  currency: string;
  unitPriceCents: number;
  postcardCount: number;
  internationalCount: number;
  internationalUnitPriceCents: number | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  refundedCents: number;
  createdAt: unknown;
}

export interface PostcardRow {
  id: string;
  orderId: string;
  designId: string;
  batchIndex: number;
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
}

export function buildPostcard(row: PostcardRow): Postcard {
  return {
    id: row.id,
    designId: row.designId,
    batchIndex: row.batchIndex,
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
    sentAt: row.sentAt === null || row.sentAt === undefined ? null : toEpochMs(row.sentAt),
    attempts: row.attempts,
    lastError: row.lastError,
  };
}

async function buildOrders(rows: OrderRow[]): Promise<Order[]> {
  if (rows.length === 0) return [];

  const postcardsByOrder = await loadPostcards(rows.map((r) => r.id));

  const designIds = new Set<string>();
  for (const list of postcardsByOrder.values()) for (const p of list) designIds.add(p.designId);
  const designs = await findDesignsByIds([...designIds]);
  const designById = new Map(designs.map((d) => [d.id, toPublicDesign(d)]));

  return rows.map((row) => {
    const postcards = postcardsByOrder.get(row.id) ?? [];
    const used = [...new Set(postcards.map((p) => p.designId))]
      .map((id) => designById.get(id))
      .filter((d): d is NonNullable<typeof d> => d !== undefined);

    return orderSchema.parse({
      id: row.id,
      reference: orderReference(row.id),
      checkoutSessionId: row.stripeCheckoutSessionId,
      email: row.email,
      status: row.status,
      currency: row.currency,
      unitPriceCents: row.unitPriceCents,
      postcardCount: row.postcardCount,
      internationalCount: row.internationalCount,
      internationalUnitPriceCents: row.internationalUnitPriceCents,
      subtotalCents: row.subtotalCents,
      discountCents: row.discountCents,
      totalCents: row.totalCents,
      refundedCents: row.refundedCents,
      createdAt: toEpochMs(row.createdAt),
      postcards,
      designs: used,
    });
  });
}

/** SQLite's default limit is 999 bound parameters, so long id lists are chunked. */
async function loadPostcards(orderIds: string[]): Promise<Map<string, Postcard[]>> {
  const { drizzle: db, schema } = await getDatabase();
  const map = new Map<string, Postcard[]>();

  for (let start = 0; start < orderIds.length; start += 500) {
    const chunk = orderIds.slice(start, start + 500);

    const rows = (await db
      .select()
      .from(schema.postcards)
      .where(inArray(schema.postcards.orderId, chunk))
      // A stable order: by mail date, then batch, then the recipient's name.
      .orderBy(
        asc(schema.postcards.mailDate),
        asc(schema.postcards.batchIndex),
        asc(schema.postcards.recipientName),
        asc(schema.postcards.id),
      )) as unknown as PostcardRow[];

    for (const row of rows) {
      const existing = map.get(row.orderId);
      const postcard = buildPostcard(row);
      if (existing) existing.push(postcard);
      else map.set(row.orderId, [postcard]);
    }
  }

  return map;
}

async function findOne(where: unknown): Promise<Order | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db.select().from(schema.orders).where(where).limit(1)) as unknown as OrderRow[];
  const [order] = await buildOrders(rows);
  return order ?? null;
}

export async function getOrder(id: string): Promise<Order | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.orders.id, id));
}

export async function findOrderByCheckoutSession(sessionId: string): Promise<Order | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.orders.stripeCheckoutSessionId, sessionId));
}

/**
 * An order, but only if it belongs to this customer.
 *
 * Filtering by `customerId` in the query itself is what makes another
 * customer's order a 404 rather than a bug waiting for someone to remove the
 * comparison.
 */
export async function getOrderForCustomer(id: string, customerId: string): Promise<Order | null> {
  const { schema } = await getDatabase();
  return findOne(and(eq(schema.orders.id, id), eq(schema.orders.customerId, customerId)));
}

export interface OrderPage {
  orders: Order[];
  total: number;
  limit: number;
  offset: number;
}

export async function listOrdersForCustomer(
  customerId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<OrderPage> {
  const { drizzle: db, schema } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const where = eq(schema.orders.customerId, customerId);

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(schema.orders)
      .where(where)
      .orderBy(desc(schema.orders.createdAt))
      .limit(limit)
      .offset(offset) as unknown as Promise<OrderRow[]>,
    db.select({ value: count() }).from(schema.orders).where(where) as unknown as Promise<{ value: number }[]>,
  ]);

  return { orders: await buildOrders(rows), total: totals[0]?.value ?? 0, limit, offset };
}

/**
 * Link every unclaimed order for an email to a customer account.
 *
 * Callers only ever pass a *verified* customer's id, so this function does not
 * re-check verification itself.
 */
export async function claimOrdersForCustomer(customerId: string, email: string): Promise<number> {
  const { drizzle: db, schema } = await getDatabase();

  const result = await db
    .update(schema.orders)
    .set({ customerId })
    .where(and(eq(sql`lower(${schema.orders.email})`, email.toLowerCase()), isNull(schema.orders.customerId)));

  return affectedRows(result);
}

export async function listOrders(
  options: {
    status?: OrderStatus;
    limit?: number;
    offset?: number;
    /** Inclusive bounds on `createdAt`, in epoch milliseconds. */
    from?: number;
    to?: number;
  } = {},
): Promise<OrderPage> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  // createdAt is unix *seconds* on SQLite and a timestamptz on Postgres.
  const bound = (epochMs: number) => (dialect === "pg" ? new Date(epochMs) : Math.floor(epochMs / 1000));

  const where = and(
    options.status ? eq(schema.orders.status, options.status) : undefined,
    options.from !== undefined ? gte(schema.orders.createdAt, bound(options.from)) : undefined,
    options.to !== undefined ? lte(schema.orders.createdAt, bound(options.to)) : undefined,
  );

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(schema.orders)
      .where(where)
      .orderBy(desc(schema.orders.createdAt))
      .limit(limit)
      .offset(offset) as unknown as Promise<OrderRow[]>,
    db.select({ value: count() }).from(schema.orders).where(where) as unknown as Promise<{ value: number }[]>,
  ]);

  return { orders: await buildOrders(rows), total: totals[0]?.value ?? 0, limit, offset };
}

export interface PaymentDetails {
  paymentIntentId: string | null;
  email: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
}

/**
 * Confirm payment: the order becomes `paid` and every card on it becomes
 * `scheduled`, which is what the fulfilment sweep looks for.
 */
export async function markOrderPaid(orderId: string, details: PaymentDetails): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await db
    .update(schema.orders)
    .set({
      status: "paid",
      stripePaymentIntentId: details.paymentIntentId,
      email: details.email,
      subtotalCents: details.subtotalCents,
      discountCents: details.discountCents,
      totalCents: details.totalCents,
      currency: details.currency,
    })
    .where(eq(schema.orders.id, orderId));

  await db
    .update(schema.postcards)
    .set({ status: "scheduled" })
    .where(and(eq(schema.postcards.orderId, orderId), eq(schema.postcards.status, "pending")));
}

export async function setOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.update(schema.orders).set({ status }).where(eq(schema.orders.id, orderId));
}

/**
 * Cancel an order: whatever has not gone to print yet is withdrawn. Cards
 * already at Lob are left as they are — the mail has gone.
 */
export async function cancelOrder(orderId: string, status: "cancelled" | "refunded" = "cancelled"): Promise<number> {
  const { drizzle: db, schema } = await getDatabase();

  const result = await db
    .update(schema.postcards)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(schema.postcards.orderId, orderId),
        inArray(schema.postcards.status, ["pending", "scheduled", "error"]),
      ),
    );

  await setOrderStatus(orderId, status);
  return affectedRows(result);
}

/** Deliberately not on the `Order` schema: only the refund path needs it. */
export async function getOrderPaymentIntentId(orderId: string): Promise<string | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ paymentIntentId: schema.orders.stripePaymentIntentId })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1)) as unknown as { paymentIntentId: string | null }[];

  return rows[0]?.paymentIntentId ?? null;
}

export async function getOrderCustomerId(orderId: string): Promise<string | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ customerId: schema.orders.customerId })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1)) as unknown as { customerId: string | null }[];

  return rows[0]?.customerId ?? null;
}

/**
 * Record a refund. Additive, in SQL rather than read-modify-write, so two
 * webhooks landing at once cannot lose one of the amounts.
 */
export async function recordRefund(orderId: string, amountCents: number): Promise<void> {
  if (amountCents <= 0) return;

  const { drizzle: db, schema } = await getDatabase();
  await db
    .update(schema.orders)
    .set({ refundedCents: sql`${schema.orders.refundedCents} + ${amountCents}` })
    .where(eq(schema.orders.id, orderId));
}

/* --------------------------------------------------------------- postcards */

/**
 * Cards due to go to Lob: scheduled, on a paid order, with a mail date on or
 * before `today` (an ISO date). Stale claims are included: a card that has
 * sat in `sending` for longer than the stale window belonged to a sweep that
 * crashed, and nothing else will ever pick it up again.
 */
export async function findDuePostcards(today: string, limit: number): Promise<PostcardRow[]> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.postcards)
    .where(and(eq(schema.postcards.status, "scheduled"), lte(schema.postcards.mailDate, today)))
    .orderBy(asc(schema.postcards.mailDate), asc(schema.postcards.id))
    .limit(limit)) as unknown as PostcardRow[];

  // The order has to still be paid: a cancelled order's cards are already
  // `cancelled`, but a refund that landed between the query and the send is
  // the case this guards.
  if (rows.length === 0) return [];
  const orderIds = [...new Set(rows.map((r) => r.orderId))];
  const orders = (await db
    .select({ id: schema.orders.id, status: schema.orders.status })
    .from(schema.orders)
    .where(inArray(schema.orders.id, orderIds))) as unknown as { id: string; status: string }[];
  const paid = new Set(orders.filter((o) => o.status === "paid").map((o) => o.id));

  return rows.filter((row) => paid.has(row.orderId));
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
    .set({
      status: "sending",
      attempts: sql`${schema.postcards.attempts} + 1`,
      updatedAt: nowFor(dialect),
    })
    .where(and(eq(schema.postcards.id, id), eq(schema.postcards.status, "scheduled")));

  return affectedRows(result) === 1;
}

/** Cards a crashed sweep left claimed. Put back so the next sweep retries them. */
export async function releaseStalePostcards(olderThan: Date): Promise<number> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const bound = dialect === "pg" ? olderThan : Math.floor(olderThan.getTime() / 1000);

  const result = await db
    .update(schema.postcards)
    .set({ status: "scheduled" })
    .where(and(eq(schema.postcards.status, "sending"), lte(schema.postcards.updatedAt, bound)));

  return affectedRows(result);
}

export async function markPostcardSent(
  id: string,
  lob: { id: string; url: string | null; expectedDeliveryDate: string | null },
): Promise<void> {
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
 * Lob refused the card, and the reason is stored in Lob's own words, which is
 * the thing v1 never kept and the reason its failures could not be debugged.
 */
export async function markPostcardFailed(
  id: string,
  message: string,
  outcome: "retry" | "error",
): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  await db
    .update(schema.postcards)
    .set({
      status: outcome === "retry" ? "scheduled" : "error",
      lastError: message.slice(0, 2000),
      updatedAt: nowFor(dialect),
    })
    .where(eq(schema.postcards.id, id));
}

/**
 * Put a claimed card back untouched.
 *
 * For a failure that was Lob's or the network's, not the card's: a rate
 * limit, or no answer at all. The claim's `attempts + 1` is undone, so an
 * hour of throttling cannot walk a card up to `MAX_ATTEMPTS` and park it for
 * a person who has nothing to fix. The message is kept so the admin can see
 * why the tick did nothing.
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

/** A postcard by id and order — the order is the scope an admin acts within. */
export async function getPostcard(orderId: string, id: string): Promise<Postcard | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.postcards)
    .where(and(eq(schema.postcards.id, id), eq(schema.postcards.orderId, orderId)))
    .limit(1)) as unknown as PostcardRow[];

  const row = rows[0];
  return row ? buildPostcard(row) : null;
}

/** Put an errored (or cancelled) card back on the schedule. Returns false if it was not one. */
export async function requeuePostcard(orderId: string, id: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const result = await db
    .update(schema.postcards)
    .set({ status: "scheduled", lastError: null, attempts: 0, updatedAt: nowFor(dialect) })
    .where(
      and(
        eq(schema.postcards.id, id),
        eq(schema.postcards.orderId, orderId),
        inArray(schema.postcards.status, ["error", "cancelled"]),
      ),
    );

  return affectedRows(result) === 1;
}

/** Withdraw one card that has not gone out. Returns false if it already had. */
export async function cancelPostcard(orderId: string, id: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const result = await db
    .update(schema.postcards)
    .set({ status: "cancelled", updatedAt: nowFor(dialect) })
    .where(
      and(
        eq(schema.postcards.id, id),
        eq(schema.postcards.orderId, orderId),
        inArray(schema.postcards.status, ["scheduled", "error"]),
      ),
    );

  return affectedRows(result) === 1;
}

/**
 * Move a paid order to `completed` once nothing on it is still waiting.
 *
 * "Waiting" is scheduled, sending or error — an errored card is still owed,
 * which is why an order with one stays open on the admin's list until someone
 * retries or cancels it.
 */
export async function completeOrderIfDone(orderId: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();

  const waiting = (await db
    .select({ value: count() })
    .from(schema.postcards)
    .where(
      and(
        eq(schema.postcards.orderId, orderId),
        inArray(schema.postcards.status, ["pending", "scheduled", "sending", "error"]),
      ),
    )) as unknown as { value: number }[];

  if ((waiting[0]?.value ?? 0) > 0) return false;

  const result = await db
    .update(schema.orders)
    .set({ status: "completed" })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, "paid")));

  return affectedRows(result) === 1;
}

/** Whether a design still has a card that has not gone out. */
export async function designHasUnsentPostcards(designId: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ value: count() })
    .from(schema.postcards)
    .where(and(eq(schema.postcards.designId, designId), ne(schema.postcards.status, "sent"), ne(schema.postcards.status, "cancelled")))) as unknown as { value: number }[];

  return (rows[0]?.value ?? 0) > 0;
}

/** For the admin overview: how many cards are in each state right now. */
export async function countPostcardsByStatus(): Promise<Record<string, number>> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ status: schema.postcards.status, value: count() })
    .from(schema.postcards)
    .groupBy(schema.postcards.status)) as unknown as { status: string; value: number }[];

  return Object.fromEntries(rows.map((row) => [row.status, row.value]));
}

/* ---------------------------------------------------------------- webhooks */

/** Record a Stripe event id, returning false if it has been seen before. */
export async function recordWebhookEvent(id: string, type: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();

  const existing = (await db
    .select({ id: schema.webhookEvents.id })
    .from(schema.webhookEvents)
    .where(eq(schema.webhookEvents.id, id))
    .limit(1)) as unknown as { id: string }[];

  if (existing.length > 0) return false;

  await db.insert(schema.webhookEvents).values({ id, type });
  return true;
}

/** Release a recorded event id, so Stripe's retry is processed rather than dismissed. */
export async function forgetWebhookEvent(id: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.delete(schema.webhookEvents).where(eq(schema.webhookEvents.id, id));
}
