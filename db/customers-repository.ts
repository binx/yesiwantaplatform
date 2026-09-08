import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import type { AddressInput } from "../shared/account.js";
import { getDatabase } from "./client.js";

/**
 * Customer addresses, and the one customer lookup the checkout webhook needs.
 *
 * Everything password- or token-shaped lives in server/auth.ts, next to the
 * admin equivalent; this is the plain data layer, matching the split between
 * that file and db/admin-repository.ts.
 */

function toBool(value: unknown): boolean {
  return value === true || value === 1;
}

interface AddressRow {
  id: string;
  customerId: string;
  name: string | null;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  isDefault: unknown;
}

function buildAddress(row: AddressRow) {
  return {
    id: row.id,
    name: row.name,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    isDefault: toBool(row.isDefault),
  };
}

export async function listAddresses(customerId: string) {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.customerAddresses)
    .where(eq(schema.customerAddresses.customerId, customerId))
    .orderBy(asc(schema.customerAddresses.createdAt))) as unknown as AddressRow[];

  return rows.map(buildAddress);
}

/**
 * An address for this customer, or null — never someone else's.
 *
 * Filtering by `customerId` in the query is what makes another customer's
 * address a 404 rather than a lookup-then-compare a future edit could drop.
 */
async function getOwnAddress(id: string, customerId: string): Promise<AddressRow | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.customerAddresses)
    .where(and(eq(schema.customerAddresses.id, id), eq(schema.customerAddresses.customerId, customerId)))
    .limit(1)) as unknown as AddressRow[];

  return rows[0] ?? null;
}

/** Clear every other default before a new one is set, so there is ever only one. */
async function clearOtherDefaults(customerId: string, keepId?: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await db
    .update(schema.customerAddresses)
    .set({ isDefault: false })
    .where(
      and(
        eq(schema.customerAddresses.customerId, customerId),
        eq(schema.customerAddresses.isDefault, true),
        ...(keepId ? [ne(schema.customerAddresses.id, keepId)] : []),
      ),
    );
}

export async function createAddress(customerId: string, input: AddressInput) {
  const { drizzle: db, schema } = await getDatabase();
  const id = randomUUID();

  // The first address a customer saves becomes their default automatically —
  // otherwise checkout prefill silently does nothing until they notice.
  const existing = await listAddresses(customerId);
  const isDefault = input.isDefault || existing.length === 0;

  if (isDefault) await clearOtherDefaults(customerId);

  await db.insert(schema.customerAddresses).values({
    id,
    customerId,
    name: input.name,
    line1: input.line1,
    line2: input.line2,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    isDefault,
  });

  return { id, ...input, isDefault };
}

export class AddressNotFoundError extends Error {
  constructor() {
    super("That address could not be found.");
    this.name = "AddressNotFoundError";
  }
}

export async function updateAddress(id: string, customerId: string, input: AddressInput) {
  const { drizzle: db, schema } = await getDatabase();

  const existing = await getOwnAddress(id, customerId);
  if (!existing) throw new AddressNotFoundError();

  if (input.isDefault) await clearOtherDefaults(customerId, id);

  await db
    .update(schema.customerAddresses)
    .set({
      name: input.name,
      line1: input.line1,
      line2: input.line2,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      country: input.country,
      isDefault: input.isDefault,
    })
    .where(eq(schema.customerAddresses.id, id));

  return { id, ...input };
}

export async function deleteAddress(id: string, customerId: string): Promise<void> {
  const existing = await getOwnAddress(id, customerId);
  if (!existing) throw new AddressNotFoundError();

  const { drizzle: db, schema } = await getDatabase();
  await db.delete(schema.customerAddresses).where(eq(schema.customerAddresses.id, id));
}

/**
 * A verified customer by email, for the checkout webhook.
 *
 * Only ever returns an account whose email is verified: linking a guest
 * order to an unverified registration would be exactly the address-disclosure
 * hole the verification gate exists to close.
 */
export async function findVerifiedCustomerByEmail(
  email: string,
): Promise<{ id: string; email: string } | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ id: schema.customers.id, email: schema.customers.email })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.email, email.toLowerCase().trim()),
        isNotNull(schema.customers.emailVerifiedAt),
      ),
    )
    .limit(1)) as unknown as { id: string; email: string }[];

  const row = rows[0];
  return row ? { id: row.id, email: row.email } : null;
}

/**
 * Store the (already hashed) unsubscribe token for this customer's next cart
 * reminder email.
 *
 * Minted fresh on every send rather than once — see the comment on
 * `cartRecoveryUnsubscribeTokenHash` in db/schema.sqlite.ts for why an older
 * email's link simply stops working once a newer one goes out.
 */
export async function setCartRecoveryUnsubscribeTokenHash(
  customerId: string,
  tokenHash: string,
): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await db
    .update(schema.customers)
    .set({ cartRecoveryUnsubscribeTokenHash: tokenHash })
    .where(eq(schema.customers.id, customerId));
}

/**
 * Redeem an unsubscribe link.
 *
 * Idempotent by design — clicking it twice only ever opts out, so unlike the
 * recovery token this needs no single-use guard.
 */
export async function optOutOfCartRecoveryByTokenHash(tokenHash: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const rows = (await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.cartRecoveryUnsubscribeTokenHash, tokenHash))
    .limit(1)) as unknown as { id: string }[];

  const row = rows[0];
  if (!row) return false;

  const now = dialect === "pg" ? new Date() : Math.floor(Date.now() / 1000);
  await db
    .update(schema.customers)
    .set({ cartRecoveryOptOutAt: now })
    .where(eq(schema.customers.id, row.id));

  return true;
}
