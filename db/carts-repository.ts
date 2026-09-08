import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import type { CartLine } from "../shared/cart.js";
import { getDatabase } from "./client.js";

/**
 * Server-side cart persistence and recovery — see
 * docs/tasks/12-abandoned-cart.md.
 *
 * Only ever populated for a signed-in customer (see `server/cart-recovery.ts`
 * for why a guest cart never reaches here), and at most one *active*
 * (unrecovered) row exists per customer at a time — the row this file's
 * functions manipulate is always found via `customerId` + `recoveredAt IS
 * NULL`, never by id from the caller.
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

function jsonFor(isPg: boolean, value: unknown): unknown {
  return isPg ? value : JSON.stringify(value);
}

/** Rows changed by an update, across both drivers — mirrors orders-repository.ts. */
function affectedRows(result: unknown): number {
  const shape = result as { changes?: number; rowCount?: number } | null;
  return shape?.changes ?? shape?.rowCount ?? 0;
}

function nowFor(dialect: string): Date | number {
  return dialect === "pg" ? new Date() : Math.floor(Date.now() / 1000);
}

export interface CartRow {
  id: string;
  customerId: string;
  email: string;
  lines: CartLine[];
  currency: string;
  recoveryTokenHash: string | null;
  reminderSentAt: unknown;
  recoveredAt: unknown;
}

interface RawCartRow {
  id: string;
  customerId: string;
  email: string;
  lines: unknown;
  currency: string;
  recoveryTokenHash: string | null;
  reminderSentAt: unknown;
  recoveredAt: unknown;
}

function buildCart(row: RawCartRow): CartRow {
  return {
    id: row.id,
    customerId: row.customerId,
    email: row.email,
    lines: parseJson<CartLine[]>(row.lines, []),
    currency: row.currency,
    recoveryTokenHash: row.recoveryTokenHash,
    reminderSentAt: row.reminderSentAt,
    recoveredAt: row.recoveredAt,
  };
}

async function findActiveCart(customerId: string): Promise<RawCartRow | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.carts)
    .where(and(eq(schema.carts.customerId, customerId), isNull(schema.carts.recoveredAt)))
    .limit(1)) as unknown as RawCartRow[];

  return rows[0] ?? null;
}

/**
 * Sync a customer's cart.
 *
 * An empty cart deletes the active row rather than storing it — there is
 * nothing to remind an empty cart about, and keeping the row around would
 * just be data collection with no purpose.
 *
 * Returns the resulting row (or null when the cart was emptied/deleted), so a
 * caller that wants to act on it immediately — the checkout.session.expired
 * path — doesn't need a second round trip to fetch it back.
 */
export async function upsertActiveCart(
  customerId: string,
  email: string,
  currency: string,
  lines: CartLine[],
): Promise<CartRow | null> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const json = jsonFor(dialect === "pg", lines);

  const existing = await findActiveCart(customerId);

  if (lines.length === 0) {
    if (existing) await db.delete(schema.carts).where(eq(schema.carts.id, existing.id));
    return null;
  }

  if (existing) {
    await db
      .update(schema.carts)
      .set({ email, currency, lines: json, updatedAt: nowFor(dialect) })
      .where(eq(schema.carts.id, existing.id));

    return {
      id: existing.id,
      customerId,
      email,
      lines,
      currency,
      recoveryTokenHash: existing.recoveryTokenHash,
      reminderSentAt: existing.reminderSentAt,
      recoveredAt: existing.recoveredAt,
    };
  }

  const id = randomUUID();
  await db.insert(schema.carts).values({ id, customerId, email, currency, lines: json });

  return {
    id,
    customerId,
    email,
    lines,
    currency,
    recoveryTokenHash: null,
    reminderSentAt: null,
    recoveredAt: null,
  };
}

/** Called when a checkout actually completes, so a stale reminder never goes out. */
export async function markActiveCartRecovered(customerId: string): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  await db
    .update(schema.carts)
    .set({ recoveredAt: nowFor(dialect) })
    .where(and(eq(schema.carts.customerId, customerId), isNull(schema.carts.recoveredAt)));
}

/**
 * Carts due for their one reminder.
 *
 * The verified-email and not-opted-out checks happen here, in SQL, joined
 * against `customers` — so an ineligible cart is never re-selected on a later
 * tick, rather than being fetched and silently skipped every 15 minutes.
 */
export async function findCartsDueForReminder(cutoff: Date, limit: number): Promise<CartRow[]> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const bound = dialect === "pg" ? cutoff : Math.floor(cutoff.getTime() / 1000);

  // No join: db/client.ts's DrizzleLike deliberately exposes only the narrow
  // slice of the query builder every other repository needs, and this is the
  // first query that would want one. Two queries plus an in-memory filter —
  // same shape as orders-repository.ts's `loadItems` batching — keeps that
  // surface as-is for a table this small.
  const candidates = (await db
    .select()
    .from(schema.carts)
    .where(
      and(
        isNull(schema.carts.reminderSentAt),
        isNull(schema.carts.recoveredAt),
        lte(schema.carts.updatedAt, bound),
      ),
    )
    .limit(limit)) as unknown as RawCartRow[];

  if (candidates.length === 0) return [];

  const customerIds = [...new Set(candidates.map((c) => c.customerId))];
  const customers = (await db
    .select({
      id: schema.customers.id,
      emailVerifiedAt: schema.customers.emailVerifiedAt,
      cartRecoveryOptOutAt: schema.customers.cartRecoveryOptOutAt,
    })
    .from(schema.customers)
    .where(inArray(schema.customers.id, customerIds))) as unknown as {
    id: string;
    emailVerifiedAt: unknown;
    cartRecoveryOptOutAt: unknown;
  }[];

  const eligible = new Set(
    customers.filter((c) => c.emailVerifiedAt != null && c.cartRecoveryOptOutAt == null).map((c) => c.id),
  );

  return candidates.filter((c) => eligible.has(c.customerId)).map(buildCart);
}

/**
 * Claim a cart for its one reminder — the guard that makes "two API
 * instances send one email" true. `UPDATE ... WHERE reminder_sent_at IS
 * NULL` means only the first of two racing claims can ever win; the loser's
 * affected-row count is zero and it sends nothing. Same idiom as
 * `restockInventoryForOrder` in db/orders-repository.ts.
 */
export async function claimReminder(cartId: string, recoveryTokenHash: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const claim = await db
    .update(schema.carts)
    .set({ reminderSentAt: nowFor(dialect), recoveryTokenHash })
    .where(and(eq(schema.carts.id, cartId), isNull(schema.carts.reminderSentAt)));

  return affectedRows(claim) === 1;
}

export async function findCartByRecoveryTokenHash(tokenHash: string): Promise<CartRow | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.carts)
    .where(eq(schema.carts.recoveryTokenHash, tokenHash))
    .limit(1)) as unknown as RawCartRow[];

  const row = rows[0];
  return row ? buildCart(row) : null;
}

/** Single-use, same conditional-update idiom as the email-verify/reset tokens in server/auth.ts. */
export async function redeemRecoveryToken(cartId: string, tokenHash: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const claim = await db
    .update(schema.carts)
    .set({ recoveryTokenHash: null, recoveredAt: nowFor(dialect) })
    .where(and(eq(schema.carts.id, cartId), eq(schema.carts.recoveryTokenHash, tokenHash)));

  return affectedRows(claim) === 1;
}
