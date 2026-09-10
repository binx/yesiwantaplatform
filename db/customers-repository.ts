import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { AddressInput, AddressSource, CustomerAddress } from "../shared/account.js";
import type { Recipient } from "../shared/postcards.js";
import { getDatabase } from "./client.js";
import { jsonFor, nowFor, parseJson, toEpochMs } from "./repository.js";

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
  label: string | null;
  tags: unknown;
  birthday: string | null;
  notes: string | null;
  source: string;
  lastSentAt: unknown;
}

const epochOrNull = (value: unknown) => (value === null || value === undefined ? null : toEpochMs(value));

function buildAddress(row: AddressRow): CustomerAddress {
  const tags = parseJson<unknown>(row.tags, []);
  return {
    id: row.id,
    name: row.name,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    verifiedAt: epochOrNull(row.verifiedAt),
    label: row.label,
    tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [],
    birthday: row.birthday,
    notes: row.notes,
    source: row.source === "manual" || row.source === "request" ? row.source : "order",
    lastSentAt: epochOrNull(row.lastSentAt),
  };
}

/**
 * What a write takes: a recipient, plus whatever of the book's own fields
 * the caller has. A paid order has none of them; the account page has all.
 */
export type AddressWrite = Recipient & Partial<Pick<AddressInput, "label" | "tags" | "birthday" | "notes">>;

function withBookFields(input: AddressWrite): AddressInput {
  return { ...input, label: input.label ?? null, tags: input.tags ?? [], birthday: input.birthday ?? null, notes: input.notes ?? null };
}

export interface AddressOptions {
  /** Whether Lob's verification just called this address deliverable, so the designer can skip asking again. */
  verified?: boolean;
  /** How the entry arrived. Defaults to a paid order. */
  source?: AddressSource;
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

export async function createAddress(customerId: string, write: AddressWrite, options: AddressOptions = {}): Promise<CustomerAddress> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const input = withBookFields(write);
  const id = randomUUID();
  const verifiedAt = options.verified ? nowFor(dialect) : null;
  const source = options.source ?? "order";
  const lastSentAt = source === "order" ? nowFor(dialect) : null;

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
    label: input.label,
    tags: jsonFor(dialect, input.tags) as never,
    birthday: input.birthday,
    notes: input.notes,
    source,
    lastSentAt,
  });

  return { id, ...input, verifiedAt: epochOrNull(verifiedAt), source, lastSentAt: epochOrNull(lastSentAt) };
}

/**
 * Save the recipients of a paid order, skipping ones the customer already has.
 *
 * Matched on the whole address rather than the name: two friends can share a
 * name, and one friend can move house.
 */
export async function saveRecipientsFromOrder(customerId: string, recipients: AddressWrite[]): Promise<number> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const existing = await listAddresses(customerId);
  const key = (r: Pick<Recipient, "name" | "line1" | "line2" | "city" | "state" | "postalCode" | "country">) =>
    [r.name, r.line1, r.line2 ?? "", r.city, r.state, r.postalCode, r.country].join("|").toLowerCase();
  const byKey = new Map(existing.map((address) => [key(address), address]));

  let added = 0;
  for (const recipient of recipients) {
    const known = byKey.get(key(recipient));
    if (known) {
      // The same person at the same address: only the date moves.
      await db
        .update(schema.customerAddresses)
        .set({ lastSentAt: nowFor(dialect), updatedAt: nowFor(dialect) })
        .where(eq(schema.customerAddresses.id, known.id));
      continue;
    }

    // A known name at a new address is kept beside the old one, with the
    // label carried over. Which one is current is the customer's call, not
    // a guess made here.
    const namesake = existing.find((address) => address.name.toLowerCase() === recipient.name.toLowerCase());
    const created = await createAddress(customerId, { ...recipient, label: recipient.label ?? namesake?.label ?? null });
    byKey.set(key(created), created);
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

export async function updateAddress(id: string, customerId: string, write: AddressWrite, options: AddressOptions = {}): Promise<CustomerAddress> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const input = withBookFields(write);

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
      label: input.label,
      tags: jsonFor(dialect, input.tags) as never,
      birthday: input.birthday,
      notes: input.notes,
      updatedAt: nowFor(dialect),
    })
    .where(eq(schema.customerAddresses.id, id));

  return { id, ...input, verifiedAt: epochOrNull(verifiedAt), source: buildAddress(existing).source, lastSentAt: epochOrNull(existing.lastSentAt) };
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
