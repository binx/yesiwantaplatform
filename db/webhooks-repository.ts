import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type {
  WebhookDeliverySummary,
  WebhookEndpointSummary,
  WebhookEventType,
} from "../shared/webhooks.js";
import { getDatabase } from "./client.js";

/**
 * Outbound webhook endpoints and their delivery queue — see
 * docs/tasks/14-outbound-webhooks.md.
 *
 * All SQL for the feature lives here; server/webhooks.ts holds the signing,
 * the SSRF guard and the dispatcher, and never writes a query of its own.
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

function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value * 1000;
  return null;
}

function stampFor(dialect: string, at: Date = new Date()): Date | number {
  return dialect === "pg" ? at : Math.floor(at.getTime() / 1000);
}

interface RawEndpointRow {
  id: string;
  url: string;
  description: string;
  secret: string;
  eventTypes: unknown;
  enabled: boolean | number;
  consecutiveFailures: number;
  disabledAt: unknown;
  lastSuccessAt: unknown;
  lastErrorAt: unknown;
  lastError: string | null;
  createdAt: unknown;
}

/** The row as the server sees it — the summary plus the signing key. */
export interface WebhookEndpointRow extends WebhookEndpointSummary {
  secret: string;
}

function buildEndpoint(row: RawEndpointRow): WebhookEndpointRow {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    secret: row.secret,
    eventTypes: parseJson<WebhookEventType[]>(row.eventTypes, []),
    enabled: Boolean(row.enabled),
    consecutiveFailures: row.consecutiveFailures,
    disabledAt: toEpochMs(row.disabledAt),
    lastSuccessAt: toEpochMs(row.lastSuccessAt),
    lastErrorAt: toEpochMs(row.lastErrorAt),
    lastError: row.lastError,
    createdAt: toEpochMs(row.createdAt) ?? Date.now(),
  };
}

/**
 * Strip the signing key.
 *
 * Every route that answers a client goes through this, so the secret cannot
 * reach the wire by someone forgetting to omit it from one response shape.
 */
export function toEndpointSummary(row: WebhookEndpointRow): WebhookEndpointSummary {
  const { secret: _secret, ...summary } = row;
  return summary;
}

export interface CreateEndpointInput {
  url: string;
  description: string;
  eventTypes: WebhookEventType[];
  enabled: boolean;
  secret: string;
}

export async function createEndpoint(input: CreateEndpointInput): Promise<WebhookEndpointRow> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const id = randomUUID();

  await db.insert(schema.webhookEndpoints).values({
    id,
    url: input.url,
    description: input.description,
    secret: input.secret,
    eventTypes: jsonFor(dialect === "pg", input.eventTypes),
    enabled: input.enabled,
  });

  const created = await findEndpoint(id);
  if (!created) throw new Error("Endpoint disappeared immediately after creation.");
  return created;
}

export async function findEndpoint(id: string): Promise<WebhookEndpointRow | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.webhookEndpoints)
    .where(eq(schema.webhookEndpoints.id, id))
    .limit(1)) as unknown as RawEndpointRow[];

  const row = rows[0];
  return row ? buildEndpoint(row) : null;
}

export async function listEndpoints(): Promise<WebhookEndpointRow[]> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.webhookEndpoints)
    .orderBy(asc(schema.webhookEndpoints.createdAt))) as unknown as RawEndpointRow[];

  return rows.map(buildEndpoint);
}

export interface UpdateEndpointInput {
  url: string;
  description: string;
  eventTypes: WebhookEventType[];
  enabled: boolean;
}

/**
 * Save an edit.
 *
 * Re-enabling clears the failure run and `disabledAt` together: a merchant who
 * has just fixed their receiver should get a clean slate, not one more failure
 * away from being switched off again.
 */
export async function updateEndpoint(id: string, input: UpdateEndpointInput): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  await db
    .update(schema.webhookEndpoints)
    .set({
      url: input.url,
      description: input.description,
      eventTypes: jsonFor(dialect === "pg", input.eventTypes),
      enabled: input.enabled,
      ...(input.enabled ? { consecutiveFailures: 0, disabledAt: null } : {}),
      updatedAt: stampFor(dialect),
    })
    .where(eq(schema.webhookEndpoints.id, id));
}

/** Mint a new signing key. The old one stops verifying immediately, by design. */
export async function rotateEndpointSecret(id: string, secret: string): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  await db
    .update(schema.webhookEndpoints)
    .set({ secret, updatedAt: stampFor(dialect) })
    .where(eq(schema.webhookEndpoints.id, id));
}

export async function deleteEndpoint(id: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.delete(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, id));
}

/**
 * The endpoints an event should fan out to.
 *
 * Filtered in memory rather than in SQL because `event_types` is a JSON array
 * in one dialect and jsonb in the other, and there is no containment operator
 * both understand. The table holds a handful of rows per store.
 */
export async function endpointsSubscribedTo(
  eventType: WebhookEventType,
): Promise<WebhookEndpointRow[]> {
  const all = await listEndpoints();
  return all.filter((endpoint) => endpoint.enabled && endpoint.eventTypes.includes(eventType));
}

interface RawDeliveryRow {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  nextAttemptAt: unknown;
  responseStatus: number | null;
  error: string | null;
  deliveredAt: unknown;
  failedAt: unknown;
  createdAt: unknown;
}

/** A delivery the dispatcher is about to send: the summary plus its body. */
export interface WebhookDeliveryRow extends WebhookDeliverySummary {
  payload: Record<string, unknown>;
}

function buildDelivery(row: RawDeliveryRow): WebhookDeliveryRow {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventId: row.eventId,
    eventType: row.eventType as WebhookEventType,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    attempts: row.attempts,
    nextAttemptAt: toEpochMs(row.nextAttemptAt),
    responseStatus: row.responseStatus,
    error: row.error,
    deliveredAt: toEpochMs(row.deliveredAt),
    failedAt: toEpochMs(row.failedAt),
    createdAt: toEpochMs(row.createdAt) ?? Date.now(),
  };
}

export function toDeliverySummary(row: WebhookDeliveryRow): WebhookDeliverySummary {
  const { payload: _payload, ...summary } = row;
  return summary;
}

export async function enqueueDelivery(input: {
  endpointId: string;
  eventId: string;
  eventType: WebhookEventType;
  payload: Record<string, unknown>;
}): Promise<string> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const id = randomUUID();

  await db.insert(schema.webhookDeliveries).values({
    id,
    endpointId: input.endpointId,
    eventId: input.eventId,
    eventType: input.eventType,
    payload: jsonFor(dialect === "pg", input.payload),
    /*
     * Written explicitly rather than left to the column default, so that "due
     * now" is judged against one clock.
     *
     * The default is the *database's* now(); `findDueDeliveries` compares
     * against this process's. On Postgres those differ by microseconds, which
     * is enough for a delivery to read as not-yet-due to the tick that just
     * enqueued it — a stall until the next pass. SQLite hid this because
     * unixepoch() floors to the second.
     */
    nextAttemptAt: stampFor(dialect),
  });

  return id;
}

/**
 * Deliveries whose next attempt is due.
 *
 * Read-only — claiming is a second, conditional step (`claimDelivery`) so that
 * two API instances ticking at the same moment cannot both send. Rows for a
 * disabled endpoint are filtered out here rather than deleted: a merchant who
 * fixes and re-enables their receiver gets the backlog, not silence.
 */
export async function findDueDeliveries(limit: number): Promise<WebhookDeliveryRow[]> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.webhookDeliveries)
    .where(
      and(
        isNull(schema.webhookDeliveries.deliveredAt),
        isNull(schema.webhookDeliveries.failedAt),
        lte(schema.webhookDeliveries.nextAttemptAt, stampFor(dialect)),
      ),
    )
    .orderBy(asc(schema.webhookDeliveries.nextAttemptAt))
    .limit(limit)) as unknown as RawDeliveryRow[];

  return rows.map(buildDelivery);
}

/**
 * Take ownership of one delivery attempt.
 *
 * The same conditional-update idiom as `claimReminder` in
 * db/carts-repository.ts: `WHERE attempts = <what we read>` means only the
 * first of two racing claims wins, so a duplicate tick across instances costs
 * one query rather than a duplicate POST. Pushing `next_attempt_at` out by the
 * lease is what makes a process that dies mid-send recoverable — the row
 * simply becomes due again.
 */
export async function claimDelivery(
  id: string,
  observedAttempts: number,
  leaseMs: number,
): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const claim = await db
    .update(schema.webhookDeliveries)
    .set({
      attempts: observedAttempts + 1,
      nextAttemptAt: stampFor(dialect, new Date(Date.now() + leaseMs)),
      updatedAt: stampFor(dialect),
    })
    .where(
      and(
        eq(schema.webhookDeliveries.id, id),
        eq(schema.webhookDeliveries.attempts, observedAttempts),
        isNull(schema.webhookDeliveries.deliveredAt),
        isNull(schema.webhookDeliveries.failedAt),
      ),
    );

  return affectedRows(claim) === 1;
}

export async function markDelivered(id: string, responseStatus: number): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const now = stampFor(dialect);

  await db
    .update(schema.webhookDeliveries)
    .set({ deliveredAt: now, responseStatus, error: null, updatedAt: now })
    .where(eq(schema.webhookDeliveries.id, id));
}

export async function scheduleRetry(
  id: string,
  outcome: { responseStatus: number | null; error: string; nextAttemptAt: Date },
): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  await db
    .update(schema.webhookDeliveries)
    .set({
      responseStatus: outcome.responseStatus,
      error: outcome.error,
      nextAttemptAt: stampFor(dialect, outcome.nextAttemptAt),
      updatedAt: stampFor(dialect),
    })
    .where(eq(schema.webhookDeliveries.id, id));
}

/** Retries exhausted. The row stays for the admin to see and redeliver. */
export async function markFailed(
  id: string,
  outcome: { responseStatus: number | null; error: string },
): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const now = stampFor(dialect);

  await db
    .update(schema.webhookDeliveries)
    .set({
      failedAt: now,
      responseStatus: outcome.responseStatus,
      error: outcome.error,
      updatedAt: now,
    })
    .where(eq(schema.webhookDeliveries.id, id));
}

/** Put a delivery back on the queue from the top — the "redeliver this one" button. */
export async function resetDelivery(id: string): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const now = stampFor(dialect);

  const reset = await db
    .update(schema.webhookDeliveries)
    .set({
      attempts: 0,
      nextAttemptAt: now,
      deliveredAt: null,
      failedAt: null,
      responseStatus: null,
      error: null,
      updatedAt: now,
    })
    .where(eq(schema.webhookDeliveries.id, id));

  return affectedRows(reset) === 1;
}

export async function findDelivery(id: string): Promise<WebhookDeliveryRow | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.id, id))
    .limit(1)) as unknown as RawDeliveryRow[];

  const row = rows[0];
  return row ? buildDelivery(row) : null;
}

/**
 * The delivery log for one endpoint, newest first.
 *
 * `id` breaks ties because SQLite's `created_at` is whole seconds: a burst of
 * events for one order all carry the same stamp, and without a tiebreaker the
 * admin's list would reorder itself between refreshes. Rows inside one second
 * are simultaneous as far as this table can tell, so any stable order will do
 * — what matters is that it is stable.
 */
export async function listDeliveries(
  endpointId: string,
  limit: number,
): Promise<WebhookDeliveryRow[]> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.endpointId, endpointId))
    .orderBy(desc(schema.webhookDeliveries.createdAt), desc(schema.webhookDeliveries.id))
    .limit(limit)) as unknown as RawDeliveryRow[];

  return rows.map(buildDelivery);
}

/** A delivery got through: clear the endpoint's failure run. */
export async function recordEndpointSuccess(endpointId: string): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const now = stampFor(dialect);

  await db
    .update(schema.webhookEndpoints)
    .set({ consecutiveFailures: 0, lastSuccessAt: now, updatedAt: now })
    .where(eq(schema.webhookEndpoints.id, endpointId));
}

/**
 * A delivery gave up: extend the failure run, and switch the endpoint off if
 * that run has reached the cap.
 *
 * Incremented in SQL rather than read-modify-written, so two dispatchers
 * exhausting two deliveries at once cannot both write the same number.
 * Returns true when this call is the one that disabled it, so the caller can
 * say so in the log exactly once.
 */
export async function recordEndpointFailure(
  endpointId: string,
  message: string,
  cap: number,
): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const now = stampFor(dialect);

  await db
    .update(schema.webhookEndpoints)
    .set({
      consecutiveFailures: sql`${schema.webhookEndpoints.consecutiveFailures} + 1`,
      lastErrorAt: now,
      lastError: message.slice(0, 500),
      updatedAt: now,
    })
    .where(eq(schema.webhookEndpoints.id, endpointId));

  const disabled = await db
    .update(schema.webhookEndpoints)
    .set({ enabled: false, disabledAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.webhookEndpoints.id, endpointId),
        eq(schema.webhookEndpoints.enabled, true),
        sql`${schema.webhookEndpoints.consecutiveFailures} >= ${cap}`,
      ),
    );

  return affectedRows(disabled) === 1;
}
