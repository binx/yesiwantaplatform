import { and, eq, isNotNull } from "drizzle-orm";
import { recipientSchema, type Recipient } from "../shared/postcards.js";
import { getDatabase } from "./client.js";
import { jsonFor, nowFor, parseJson } from "./repository.js";

/**
 * The plain data on a customer: their mailing address and their Stripe
 * customer. Everything password- or token-shaped lives in server/auth.ts.
 */

/** Where this person's postcards go, or null until they say. */
export async function getMailingAddress(customerId: string): Promise<Recipient | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ address: schema.customers.address })
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1)) as unknown as { address: unknown }[];
  const row = rows[0];
  if (!row) return null;
  // A hand-edited row that no longer passes reads as "no address", which
  // makes the subscribe flow ask again rather than mail somewhere odd.
  return recipientSchema.nullable().catch(null).parse(parseJson(row.address, null));
}

export async function setMailingAddress(customerId: string, address: Recipient): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.customers)
    .set({ address: jsonFor(dialect, address) as never, updatedAt: nowFor(dialect) })
    .where(eq(schema.customers.id, customerId));
}

/** Stripe's Customer for this person, made once and reused for every subscription. */
export async function getStripeCustomerId(customerId: string): Promise<string | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ stripeCustomerId: schema.customers.stripeCustomerId })
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1)) as unknown as { stripeCustomerId: string | null }[];
  return rows[0]?.stripeCustomerId ?? null;
}

export async function setStripeCustomerId(customerId: string, stripeCustomerId: string): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.customers)
    .set({ stripeCustomerId, updatedAt: nowFor(dialect) })
    .where(eq(schema.customers.id, customerId));
}

/** The customer behind a Stripe Customer id, for webhooks that only carry that. */
export async function findCustomerByStripeId(stripeCustomerId: string): Promise<{ id: string; email: string } | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ id: schema.customers.id, email: schema.customers.email })
    .from(schema.customers)
    .where(eq(schema.customers.stripeCustomerId, stripeCustomerId))
    .limit(1)) as unknown as { id: string; email: string }[];
  return rows[0] ?? null;
}

/**
 * A verified customer by email.
 *
 * Only ever returns an account whose email is verified: nothing on the
 * platform links data to an unverified registration, so registering with a
 * stranger's address gains nothing.
 */
export async function findVerifiedCustomerByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ id: schema.customers.id, email: schema.customers.email })
    .from(schema.customers)
    .where(and(eq(schema.customers.email, email.toLowerCase().trim()), isNotNull(schema.customers.emailVerifiedAt)))
    .limit(1)) as unknown as { id: string; email: string }[];

  const row = rows[0];
  return row ? { id: row.id, email: row.email } : null;
}

export interface CustomerListRow {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  createdAt: number;
  /** Their artist slug, when they have a page. */
  artistSlug: string | null;
  activeSubscriptions: number;
}
