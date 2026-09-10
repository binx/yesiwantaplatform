import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { AddressInput, CustomerAddress } from "../shared/account.js";
import { getDatabase } from "./client.js";
import { nowFor, toEpochMs } from "./repository.js";

/**
 * Saved recipients, and the one customer lookup the checkout webhook needs.
 *
 * Everything password- or token-shaped lives in server/auth.ts; this is the
 * plain data layer.
 */

interface AddressRow {
  id: string;
  customerId: string;
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  verifiedAt: unknown;
}

function buildAddress(row: AddressRow): CustomerAddress {
  return {
    id: row.id,
    name: row.name,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    verifiedAt: row.verifiedAt === null || row.verifiedAt === undefined ? null : toEpochMs(row.verifiedAt),
  };
}

/** Whether Lob's verification just called this address deliverable, so the designer can skip asking again. */
export interface AddressOptions {
  verified?: boolean;
}

export async function listAddresses(customerId: string): Promise<CustomerAddress[]> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.customerAddresses)
    .where(eq(schema.customerAddresses.customerId, customerId))
    .orderBy(asc(schema.customerAddresses.name), asc(schema.customerAddresses.createdAt))) as unknown as AddressRow[];

  return rows.map(buildAddress);
}

/** An address for this customer, or null — never someone else's. */
async function getOwnAddress(id: string, customerId: string): Promise<AddressRow | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.customerAddresses)
    .where(and(eq(schema.customerAddresses.id, id), eq(schema.customerAddresses.customerId, customerId)))
    .limit(1)) as unknown as AddressRow[];

  return rows[0] ?? null;
}

export async function createAddress(customerId: string, input: AddressInput, options: AddressOptions = {}): Promise<CustomerAddress> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const id = randomUUID();
  const verifiedAt = options.verified ? nowFor(dialect) : null;

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
    verifiedAt,
  });

  return { id, ...input, verifiedAt: verifiedAt === null ? null : toEpochMs(verifiedAt) };
}

/**
 * Save the recipients of a paid order, skipping ones the customer already has.
 *
 * Matched on the whole address rather than the name: two friends can share a
 * name, and one friend can move house.
 */
export async function saveRecipientsFromOrder(customerId: string, recipients: AddressInput[]): Promise<number> {
  const existing = await listAddresses(customerId);
  const key = (r: AddressInput) =>
    [r.name, r.line1, r.line2 ?? "", r.city, r.state, r.postalCode, r.country].join("|").toLowerCase();
  const seen = new Set(existing.map(key));

  let added = 0;
  for (const recipient of recipients) {
    if (seen.has(key(recipient))) continue;
    seen.add(key(recipient));
    await createAddress(customerId, recipient);
    added += 1;
  }
  return added;
}

export class AddressNotFoundError extends Error {
  constructor() {
    super("That recipient could not be found.");
    this.name = "AddressNotFoundError";
  }
}

export async function updateAddress(id: string, customerId: string, input: AddressInput, options: AddressOptions = {}): Promise<CustomerAddress> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const existing = await getOwnAddress(id, customerId);
  if (!existing) throw new AddressNotFoundError();

  // An edit is a new address as far as USPS is concerned: verified again or not at all.
  const verifiedAt = options.verified ? nowFor(dialect) : null;

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
      verifiedAt,
    })
    .where(eq(schema.customerAddresses.id, id));

  return { id, ...input, verifiedAt: verifiedAt === null ? null : toEpochMs(verifiedAt) };
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
      and(eq(schema.customers.email, email.toLowerCase().trim()), isNotNull(schema.customers.emailVerifiedAt)),
    )
    .limit(1)) as unknown as { id: string; email: string }[];

  const row = rows[0];
  return row ? { id: row.id, email: row.email } : null;
}

/** Store the (already hashed) unsubscribe token for this customer's next cart reminder. */
export async function setCartRecoveryUnsubscribeTokenHash(customerId: string, tokenHash: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await db
    .update(schema.customers)
    .set({ cartRecoveryUnsubscribeTokenHash: tokenHash })
    .where(eq(schema.customers.id, customerId));
}

/** Redeem an unsubscribe link. Idempotent — clicking it twice only ever opts out. */
export async function optOutOfCartRecoveryByTokenHash(tokenHash: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const rows = (await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.cartRecoveryUnsubscribeTokenHash, tokenHash))
    .limit(1)) as unknown as { id: string }[];

  const row = rows[0];
  if (!row) return false;

  await db
    .update(schema.customers)
    .set({ cartRecoveryOptOutAt: nowFor(dialect) })
    .where(eq(schema.customers.id, row.id));

  return true;
}
