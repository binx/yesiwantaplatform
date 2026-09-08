import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  orderReference,
  orderSchema,
  type Order,
  type OrderStatus,
} from "../shared/orders.js";
import { getDatabase } from "./client.js";

/**
 * Orders.
 *
 * Stripe's Orders API is gone, so this is where order state lives. Stripe is
 * still the authority on payment; fulfilment is entirely ours.
 */

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toBool(value: unknown): boolean {
  return value === true || value === 1;
}

/** SQLite stores unix seconds; Postgres a timestamptz. Normalise to ms. */
function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value * 1000;
  return Date.now();
}

function jsonFor(isPg: boolean, value: unknown): unknown {
  return isPg ? value : JSON.stringify(value);
}

export interface PendingOrderLine {
  productId: string;
  variantId: string;
  productName: string;
  variantLabel: string;
  /** Read from the database, never from the client. */
  unitPriceCents: number;
  quantity: number;
  options: Record<string, string>;
}

export interface CreatePendingOrderInput {
  /** Minted by the caller so it can go into the Stripe session's metadata. */
  id: string;
  checkoutSessionId: string;
  email: string;
  currency: string;
  subtotalCents: number;
  lines: PendingOrderLine[];
}

export async function createPendingOrder(input: CreatePendingOrderInput): Promise<string> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const json = (v: unknown) => jsonFor(dialect === "pg", v);

  const id = input.id;

  await db.insert(schema.orders).values({
    id,
    stripeCheckoutSessionId: input.checkoutSessionId,
    email: input.email,
    status: "pending",
    currency: input.currency,
    subtotalCents: input.subtotalCents,
    totalCents: input.subtotalCents,
  });

  for (const line of input.lines) {
    await db.insert(schema.orderItems).values({
      id: randomUUID(),
      orderId: id,
      productId: line.productId,
      variantId: line.variantId,
      productName: line.productName,
      variantLabel: line.variantLabel,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      options: json(line.options),
    });
  }

  return id;
}

interface OrderRow {
  id: string;
  email: string;
  status: string;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  shippingName: string | null;
  shippingLine1: string | null;
  shippingLine2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingPostalCode: string | null;
  shippingCountry: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  oversold: unknown;
  refundedCents: number;
  createdAt: unknown;
}

interface OrderItemRow {
  id: string;
  orderId: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  variantLabel: string;
  unitPriceCents: number;
  quantity: number;
  options: unknown;
}

function buildOrder(row: OrderRow, items: OrderItemRow[]): Order {
  return orderSchema.parse({
    id: row.id,
    reference: orderReference(row.id),
    email: row.email,
    status: row.status,
    currency: row.currency,
    subtotalCents: row.subtotalCents,
    shippingCents: row.shippingCents,
    taxCents: row.taxCents,
    totalCents: row.totalCents,
    shipping: {
      name: row.shippingName,
      line1: row.shippingLine1,
      line2: row.shippingLine2,
      city: row.shippingCity,
      state: row.shippingState,
      postalCode: row.shippingPostalCode,
      country: row.shippingCountry,
    },
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    oversold: toBool(row.oversold),
    refundedCents: row.refundedCents,
    createdAt: toEpochMs(row.createdAt),
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      productName: i.productName,
      variantLabel: i.variantLabel,
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
      options: parseJson<Record<string, string>>(i.options, {}),
    })),
  });
}

/**
 * SQLite's default limit is 999 bound parameters, so a single `inArray` over a
 * long id list fails with SQLITE_ERROR. `listOrders` clamps to 100 today, but
 * chunking here means a future caller with a bigger list doesn't have to know.
 */
const ITEM_ID_CHUNK = 500;

/** Exported so the dialect tests can exercise the chunking guard directly. */
export async function loadItems(orderIds: string[]): Promise<Map<string, OrderItemRow[]>> {
  const { drizzle: db, schema } = await getDatabase();
  if (orderIds.length === 0) return new Map();

  const map = new Map<string, OrderItemRow[]>();

  for (let start = 0; start < orderIds.length; start += ITEM_ID_CHUNK) {
    const chunk = orderIds.slice(start, start + ITEM_ID_CHUNK);

    // v1 selected the whole table and filtered in JS, with an includes() in the
    // loop — quadratic, and on the payment webhook's path via getOrder.
    // order_items has no position column, so sort by id: without it the engine
    // is free to return the same order's lines in a different order each call.
    const rows = (await db
      .select()
      .from(schema.orderItems)
      .where(inArray(schema.orderItems.orderId, chunk))
      .orderBy(asc(schema.orderItems.id))) as unknown as OrderItemRow[];

    for (const row of rows) {
      const existing = map.get(row.orderId);
      if (existing) existing.push(row);
      else map.set(row.orderId, [row]);
    }
  }

  return map;
}

export async function getOrder(id: string): Promise<Order | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1)) as unknown as OrderRow[];

  const row = rows[0];
  if (!row) return null;

  const items = await loadItems([row.id]);
  return buildOrder(row, items.get(row.id) ?? []);
}

export async function findOrderByCheckoutSession(sessionId: string): Promise<Order | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.stripeCheckoutSessionId, sessionId))
    .limit(1)) as unknown as OrderRow[];

  const row = rows[0];
  if (!row) return null;

  const items = await loadItems([row.id]);
  return buildOrder(row, items.get(row.id) ?? []);
}

export interface OrderPage {
  orders: Order[];
  total: number;
  limit: number;
  offset: number;
}

export async function listOrders(
  options: { status?: OrderStatus; limit?: number; offset?: number } = {},
): Promise<OrderPage> {
  const { drizzle: db, schema } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = options.status ? eq(schema.orders.status, options.status) : undefined;

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(schema.orders)
      .where(where)
      .orderBy(desc(schema.orders.createdAt))
      .limit(limit)
      .offset(offset) as unknown as Promise<OrderRow[]>,
    db.select({ value: count() }).from(schema.orders).where(where) as unknown as Promise<
      { value: number }[]
    >,
  ]);

  const items = await loadItems(rows.map((r) => r.id));

  return {
    orders: rows.map((row) => buildOrder(row, items.get(row.id) ?? [])),
    total: totals[0]?.value ?? 0,
    limit,
    offset,
  };
}

export interface PaymentDetails {
  paymentIntentId: string | null;
  email: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  shipping: {
    name: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  };
}

export async function markOrderPaid(orderId: string, details: PaymentDetails): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await db
    .update(schema.orders)
    .set({
      status: "paid",
      stripePaymentIntentId: details.paymentIntentId,
      email: details.email,
      subtotalCents: details.subtotalCents,
      shippingCents: details.shippingCents,
      taxCents: details.taxCents,
      totalCents: details.totalCents,
      currency: details.currency,
      shippingName: details.shipping.name,
      shippingLine1: details.shipping.line1,
      shippingLine2: details.shipping.line2,
      shippingCity: details.shipping.city,
      shippingState: details.shipping.state,
      shippingPostalCode: details.shipping.postalCode,
      shippingCountry: details.shipping.country,
    })
    .where(eq(schema.orders.id, orderId));
}

export async function updateFulfilment(
  orderId: string,
  input: { status: OrderStatus; carrier: string | null; trackingNumber: string | null },
): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await db
    .update(schema.orders)
    .set({
      status: input.status,
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
    })
    .where(eq(schema.orders.id, orderId));
}

/**
 * The Stripe payment intent for an order.
 *
 * Deliberately not on the `Order` schema. Only the refund path needs it, and
 * `Order` is serialised to buyers on the confirmation page — a field that never
 * enters the shared type cannot leak from a response someone forgets to narrow.
 */
export async function getOrderPaymentIntentId(orderId: string): Promise<string | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ paymentIntentId: schema.orders.stripePaymentIntentId })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1)) as unknown as { paymentIntentId: string | null }[];

  return rows[0]?.paymentIntentId ?? null;
}

/**
 * Record a refund. Additive, because Stripe allows several partial refunds
 * against one charge and each arrives as its own webhook.
 *
 * The increment happens in SQL rather than as a read-modify-write, so two
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

async function flagOversold(orderId: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.update(schema.orders).set({ oversold: true }).where(eq(schema.orders.id, orderId));
}

/**
 * Decrement stock for a paid order.
 *
 * The update is guarded (`quantity >= n`) so it can never drive stock negative
 * under concurrent checkouts, without needing a transaction API that differs
 * between the two dialects. If a line cannot be satisfied the payment has
 * already succeeded, so the order is still recorded and flagged `oversold` for
 * the owner — refusing it silently or dropping it would be worse.
 */
export async function decrementInventoryForOrder(orderId: string): Promise<string[]> {
  const { drizzle: db, schema } = await getDatabase();

  const order = await getOrder(orderId);
  if (!order) return [];

  const shortfalls: string[] = [];

  for (const item of order.items) {
    if (!item.variantId) continue;

    const before = (await db
      .select({
        quantity: schema.variants.inventoryQuantity,
        type: schema.variants.inventoryType,
      })
      .from(schema.variants)
      .where(eq(schema.variants.id, item.variantId))
      .limit(1)) as unknown as { quantity: number; type: string }[];

    const current = before[0];
    // Unlimited stock, or the variant is gone: nothing to decrement.
    if (!current || current.type !== "finite") continue;

    await db
      .update(schema.variants)
      .set({
        inventoryQuantity: sql`${schema.variants.inventoryQuantity} - ${item.quantity}`,
      })
      .where(
        and(
          eq(schema.variants.id, item.variantId),
          eq(schema.variants.inventoryType, "finite"),
          // The guard: only decrement if there is genuinely enough.
          gte(schema.variants.inventoryQuantity, item.quantity),
        ),
      );

    const after = (await db
      .select({ quantity: schema.variants.inventoryQuantity })
      .from(schema.variants)
      .where(eq(schema.variants.id, item.variantId))
      .limit(1)) as unknown as { quantity: number }[];

    if ((after[0]?.quantity ?? 0) === current.quantity) {
      shortfalls.push(item.productName);
    }
  }

  if (shortfalls.length > 0) await flagOversold(orderId);

  return shortfalls;
}

/**
 * Record a Stripe event id, returning false if it has been seen before.
 *
 * Stripe delivers webhooks at least once, so without this a retry would create
 * a second order and decrement stock twice.
 */
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

/**
 * Release a recorded event id.
 *
 * Called when handling failed and we answered 500: Stripe will retry, and the
 * retry must be allowed to process rather than being dismissed as a duplicate.
 */
export async function forgetWebhookEvent(id: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.delete(schema.webhookEvents).where(eq(schema.webhookEvents.id, id));
}
