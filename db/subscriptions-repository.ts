import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { DEFAULT_TERM_MONTHS, type SubscriptionStatus } from "../shared/platform.js";
import { recipientSchema, type Recipient } from "../shared/postcards.js";
import { getDatabase } from "./client.js";
import { affectedRows, epochOrNull, jsonFor, nowFor, parseJson, timeFor, toBool, toCount, toEpochMs } from "./repository.js";

/**
 * Subscriptions: one person, one artist, one address, one monthly price.
 *
 * Stripe is the authority on whether a subscription is paid; the webhook is
 * the only thing that moves a row out of `incomplete`, and the only thing
 * that moves it to `past_due` or `cancelled` on Stripe's say-so. What is ours
 * is the address the cards go to and the price snapshot the ledger reads.
 */

export interface SubscriptionRow {
  id: string;
  customerId: string;
  artistId: string;
  status: string;
  stripeCheckoutSessionId: string;
  stripeSubscriptionId: string | null;
  priceCents: number;
  currency: string;
  termMonths: number;
  currentPeriodEnd: unknown;
  cancelAtPeriodEnd: unknown;
  address: unknown;
  cancelledAt: unknown;
  createdAt: unknown;
}

export interface SubscriptionRecord {
  id: string;
  customerId: string;
  artistId: string;
  status: SubscriptionStatus;
  stripeCheckoutSessionId: string;
  stripeSubscriptionId: string | null;
  priceCents: number;
  currency: string;
  /** How many monthly payments it runs for: the artist's term when it was taken out. */
  termMonths: number;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  address: Recipient;
  cancelledAt: number | null;
  createdAt: number;
}

function toStatus(value: string): SubscriptionStatus {
  return value === "active" || value === "past_due" || value === "cancelled" ? value : "incomplete";
}

export function buildSubscription(row: SubscriptionRow): SubscriptionRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    artistId: row.artistId,
    status: toStatus(row.status),
    stripeCheckoutSessionId: row.stripeCheckoutSessionId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    priceCents: row.priceCents,
    currency: row.currency,
    termMonths: Math.max(1, row.termMonths || DEFAULT_TERM_MONTHS),
    currentPeriodEnd: epochOrNull(row.currentPeriodEnd),
    cancelAtPeriodEnd: toBool(row.cancelAtPeriodEnd),
    address: recipientSchema.parse(parseJson(row.address, {})),
    cancelledAt: epochOrNull(row.cancelledAt),
    createdAt: toEpochMs(row.createdAt),
  };
}

export interface CreateSubscriptionInput {
  /** Minted by the caller so it can go into the Stripe session's metadata. */
  id: string;
  customerId: string;
  artistId: string;
  checkoutSessionId: string;
  priceCents: number;
  currency: string;
  /** The artist's term right now. Theirs may change later; this one does not. */
  termMonths: number;
  address: Recipient;
}

/** Written as `incomplete` before the subscriber reaches Stripe. The webhook finishes it. */
export async function createIncompleteSubscription(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  await db.insert(schema.subscriptions).values({
    id: input.id,
    customerId: input.customerId,
    artistId: input.artistId,
    status: "incomplete",
    stripeCheckoutSessionId: input.checkoutSessionId,
    priceCents: input.priceCents,
    currency: input.currency,
    termMonths: input.termMonths,
    address: jsonFor(dialect, input.address) as never,
  });

  const created = await getSubscription(input.id);
  if (!created) throw new Error("The subscription was not written.");
  return created;
}

async function findOne(where: unknown): Promise<SubscriptionRecord | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db.select().from(schema.subscriptions).where(where).limit(1)) as unknown as SubscriptionRow[];
  const row = rows[0];
  return row ? buildSubscription(row) : null;
}

export async function getSubscription(id: string): Promise<SubscriptionRecord | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.subscriptions.id, id));
}

/** A subscription, but only if it belongs to this customer: another person's is a 404, not a 403. */
export async function getSubscriptionForCustomer(id: string, customerId: string): Promise<SubscriptionRecord | null> {
  const { schema } = await getDatabase();
  return findOne(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.customerId, customerId)));
}

export async function findSubscriptionByCheckoutSession(sessionId: string): Promise<SubscriptionRecord | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.subscriptions.stripeCheckoutSessionId, sessionId));
}

export async function findSubscriptionByStripeId(stripeSubscriptionId: string): Promise<SubscriptionRecord | null> {
  const { schema } = await getDatabase();
  return findOne(eq(schema.subscriptions.stripeSubscriptionId, stripeSubscriptionId));
}

/** This customer's live subscription to this artist, if any: `incomplete` ones do not count. */
export async function findOpenSubscription(customerId: string, artistId: string): Promise<SubscriptionRecord | null> {
  const { schema } = await getDatabase();
  return findOne(
    and(
      eq(schema.subscriptions.customerId, customerId),
      eq(schema.subscriptions.artistId, artistId),
      inArray(schema.subscriptions.status, ["active", "past_due"]),
    ),
  );
}

export async function listSubscriptionsForCustomer(customerId: string): Promise<SubscriptionRecord[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.customerId, customerId), inArray(schema.subscriptions.status, ["active", "past_due", "cancelled"])))
    .orderBy(desc(schema.subscriptions.createdAt), desc(schema.subscriptions.id))) as unknown as SubscriptionRow[];
  return rows.map(buildSubscription);
}

/** Everyone subscribed to an artist, for the studio's list and the admin. Incomplete rows are noise and left out. */
export async function listSubscriptionsForArtist(artistId: string): Promise<SubscriptionRecord[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.artistId, artistId), inArray(schema.subscriptions.status, ["active", "past_due", "cancelled"])))
    .orderBy(desc(schema.subscriptions.createdAt), desc(schema.subscriptions.id))) as unknown as SubscriptionRow[];
  return rows.map(buildSubscription);
}

/** The subscriptions a mailing goes to: active, and nothing else. */
export async function listActiveSubscriptionsForArtist(artistId: string): Promise<SubscriptionRecord[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.artistId, artistId), eq(schema.subscriptions.status, "active")))
    .orderBy(asc(schema.subscriptions.createdAt), asc(schema.subscriptions.id))) as unknown as SubscriptionRow[];
  return rows.map(buildSubscription);
}

export interface SubscriptionPage {
  subscriptions: SubscriptionRecord[];
  total: number;
}

export async function listSubscriptions(options: { status?: SubscriptionStatus; limit?: number; offset?: number } = {}): Promise<SubscriptionPage> {
  const { drizzle: db, schema } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = options.status ? eq(schema.subscriptions.status, options.status) : undefined;

  const [rows, totals] = await Promise.all([
    db.select().from(schema.subscriptions).where(where).orderBy(desc(schema.subscriptions.createdAt)).limit(limit).offset(offset) as unknown as Promise<SubscriptionRow[]>,
    db.select({ value: count() }).from(schema.subscriptions).where(where) as unknown as Promise<{ value: unknown }[]>,
  ]);
  return { subscriptions: rows.map(buildSubscription), total: toCount(totals[0]?.value) };
}

export interface ActivationDetails {
  stripeSubscriptionId: string;
  currentPeriodEnd: number | null;
}

/**
 * The webhook's confirmation: Checkout completed and Stripe holds a
 * subscription. Only an `incomplete` row moves, so a replayed event is a
 * no-op rather than a reactivation of something the subscriber since ended.
 */
export async function activateSubscription(id: string, details: ActivationDetails): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.subscriptions)
    .set({
      status: "active",
      stripeSubscriptionId: details.stripeSubscriptionId,
      currentPeriodEnd: details.currentPeriodEnd === null ? null : timeFor(dialect, details.currentPeriodEnd),
      updatedAt: nowFor(dialect),
    })
    .where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.status, "incomplete")));
  return affectedRows(result) === 1;
}

export interface SyncDetails {
  status: SubscriptionStatus;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

/** Mirror what Stripe says about a subscription: status, period end, and whether it is winding down. */
export async function syncSubscription(id: string, details: SyncDetails): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.subscriptions)
    .set({
      status: details.status,
      currentPeriodEnd: details.currentPeriodEnd === null ? null : timeFor(dialect, details.currentPeriodEnd),
      cancelAtPeriodEnd: details.cancelAtPeriodEnd,
      ...(details.status === "cancelled" ? { cancelledAt: nowFor(dialect) } : {}),
      updatedAt: nowFor(dialect),
    })
    .where(eq(schema.subscriptions.id, id));
}

/** The subscriber asked to stop (or changed their mind). Stripe is told separately; this is the mirror. */
export async function setCancelAtPeriodEnd(id: string, cancelAtPeriodEnd: boolean): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.subscriptions)
    .set({ cancelAtPeriodEnd, updatedAt: nowFor(dialect) })
    .where(eq(schema.subscriptions.id, id));
}

/** A Checkout that expired unpaid: the row was never anything, so it goes. */
export async function deleteIncompleteSubscription(id: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const result = await db
    .delete(schema.subscriptions)
    .where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.status, "incomplete")));
  return affectedRows(result) === 1;
}

/** Update the mailing address on every open subscription this customer holds — they moved. */
export async function updateSubscriptionAddresses(customerId: string, address: Recipient): Promise<number> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const result = await db
    .update(schema.subscriptions)
    .set({ address: jsonFor(dialect, address) as never, updatedAt: nowFor(dialect) })
    .where(and(eq(schema.subscriptions.customerId, customerId), inArray(schema.subscriptions.status, ["incomplete", "active", "past_due"])));
  return affectedRows(result);
}

/** How many cards have been mailed under each of a set of subscriptions. */
export async function countPostcardsForSubscriptions(subscriptionIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (subscriptionIds.length === 0) return map;
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ subscriptionId: schema.postcards.subscriptionId, value: count() })
    .from(schema.postcards)
    .where(and(inArray(schema.postcards.subscriptionId, [...new Set(subscriptionIds)]), eq(schema.postcards.status, "sent")))
    .groupBy(schema.postcards.subscriptionId)) as unknown as { subscriptionId: string; value: unknown }[];
  for (const row of rows) map.set(row.subscriptionId, toCount(row.value));
  return map;
}

/** For the admin overview: subscriptions in each state right now. */
export async function countSubscriptionsByStatus(): Promise<Record<string, number>> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ status: schema.subscriptions.status, value: count() })
    .from(schema.subscriptions)
    .groupBy(schema.subscriptions.status)) as unknown as { status: string; value: unknown }[];
  return Object.fromEntries(rows.map((row) => [row.status, toCount(row.value)]));
}

/** A fresh id for a subscription, minted before Stripe is asked so it can travel in the session's metadata. */
export function newSubscriptionId(): string {
  return randomUUID();
}
