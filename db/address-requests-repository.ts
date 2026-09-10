import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AddressRequestInput, AddressRequestStatus, CustomerAddress } from "../shared/account.js";
import type { Recipient } from "../shared/postcards.js";
import { getDatabase } from "./client.js";
import { createAddress } from "./customers-repository.js";
import { nowFor, toBool, toEpochMs } from "./repository.js";

/**
 * "Send me your address" links.
 *
 * A row is a link the customer handed out. A single link is fulfilled by its
 * first response; a collector stays open and takes up to `MULTI_CAP`. Expiry
 * is read, not written: an open row past its `expiresAt` reads as `expired`,
 * and renewing it moves the date rather than minting a new token, so the
 * link the customer already sent keeps working.
 */

/** A collector link's ceiling. A holiday list, not a mailing list. */
export const MULTI_CAP = 200;

interface RequestRow {
  id: string;
  customerId: string;
  token: string;
  label: string;
  multi: unknown;
  status: string;
  notifyByEmail: unknown;
  responses: number;
  expiresAt: unknown;
  createdAt: unknown;
}

export interface AddressRequestRecord {
  id: string;
  customerId: string;
  token: string;
  label: string;
  multi: boolean;
  status: AddressRequestStatus;
  notifyByEmail: boolean;
  responses: number;
  expiresAt: number;
  createdAt: number;
}

function build(row: RequestRow, now = Date.now()): AddressRequestRecord {
  const expiresAt = toEpochMs(row.expiresAt);
  const stored = row.status === "fulfilled" || row.status === "revoked" ? row.status : "open";
  return {
    id: row.id,
    customerId: row.customerId,
    token: row.token,
    label: row.label,
    multi: toBool(row.multi),
    status: stored === "open" && expiresAt < now ? "expired" : stored,
    notifyByEmail: toBool(row.notifyByEmail),
    responses: row.responses,
    expiresAt,
    createdAt: toEpochMs(row.createdAt),
  };
}

function expiry(dialect: string, days: number): Date | number {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return dialect === "pg" ? at : Math.floor(at.getTime() / 1000);
}

export async function createAddressRequest(customerId: string, input: AddressRequestInput): Promise<AddressRequestRecord> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");

  await db.insert(schema.addressRequests).values({
    id,
    customerId,
    token,
    label: input.label,
    multi: input.multi,
    status: "open",
    notifyByEmail: input.notifyByEmail,
    responses: 0,
    expiresAt: expiry(dialect, input.expiresInDays) as never,
  });

  return (await getOwnRequest(id, customerId))!;
}

async function getOwnRequest(id: string, customerId: string): Promise<AddressRequestRecord | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.addressRequests)
    .where(and(eq(schema.addressRequests.id, id), eq(schema.addressRequests.customerId, customerId)))
    .limit(1)) as unknown as RequestRow[];
  return rows[0] ? build(rows[0]) : null;
}

/** This customer's links, newest first. */
export async function listAddressRequests(customerId: string): Promise<AddressRequestRecord[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.addressRequests)
    .where(eq(schema.addressRequests.customerId, customerId))
    .orderBy(desc(schema.addressRequests.createdAt))) as unknown as RequestRow[];
  return rows.map((row) => build(row));
}

/** Another ninety days on the same link. A revoked link stays revoked. */
export async function renewAddressRequest(id: string, customerId: string, days = 90): Promise<AddressRequestRecord | null> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const existing = await getOwnRequest(id, customerId);
  if (!existing || existing.status === "revoked") return existing;

  await db
    .update(schema.addressRequests)
    .set({ expiresAt: expiry(dialect, days) as never, updatedAt: nowFor(dialect) })
    .where(eq(schema.addressRequests.id, id));
  return getOwnRequest(id, customerId);
}

export async function revokeAddressRequest(id: string, customerId: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const existing = await getOwnRequest(id, customerId);
  if (!existing) return false;

  await db
    .update(schema.addressRequests)
    .set({ status: "revoked", updatedAt: nowFor(dialect) })
    .where(eq(schema.addressRequests.id, id));
  return true;
}

export interface AddressRequestByToken {
  request: AddressRequestRecord;
  requester: { id: string; email: string; name: string | null };
}

/** The link a responder opened, with who asked. Null for a token nobody was given. */
export async function findAddressRequestByToken(token: string): Promise<AddressRequestByToken | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ request: schema.addressRequests, id: schema.customers.id, email: schema.customers.email, name: schema.customers.name })
    .from(schema.addressRequests)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.addressRequests.customerId))
    .where(eq(schema.addressRequests.token, token))
    .limit(1)) as unknown as { request: RequestRow; id: string; email: string; name: string | null }[];

  const row = rows[0];
  return row ? { request: build(row.request), requester: { id: row.id, email: row.email, name: row.name } } : null;
}

export class RequestClosedError extends Error {
  constructor(status: AddressRequestStatus | "full") {
    super(
      status === "fulfilled"
        ? "This link has already been used."
        : status === "full"
          ? "This link has taken as many addresses as it can."
          : "This link is no longer active.",
    );
    this.name = "RequestClosedError";
  }
}

/**
 * A responder's address, into the requester's book.
 *
 * A single link's label is the responder's name as the requester typed it,
 * so it becomes the entry's label; a collector's label is a purpose and is
 * not. The first response fulfils a single link; a collector counts up to
 * its cap.
 */
export async function recordAddressResponse(
  request: AddressRequestRecord,
  recipient: Recipient,
  options: { verified: boolean },
): Promise<CustomerAddress> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  if (request.status !== "open") throw new RequestClosedError(request.status);
  if (request.multi && request.responses >= MULTI_CAP) throw new RequestClosedError("full");

  const address = await createAddress(
    request.customerId,
    { ...recipient, label: request.multi ? null : request.label },
    { verified: options.verified, source: "request", requestId: request.id },
  );

  await db
    .update(schema.addressRequests)
    .set({
      responses: sql`${schema.addressRequests.responses} + 1`,
      status: request.multi ? "open" : "fulfilled",
      updatedAt: nowFor(dialect),
    })
    .where(eq(schema.addressRequests.id, request.id));

  return address;
}
