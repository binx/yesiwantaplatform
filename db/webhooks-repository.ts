import { eq } from "drizzle-orm";
import { getDatabase } from "./client.js";

/**
 * Webhook deduplication, shared by the Stripe and Lob routes.
 *
 * Both providers deliver at least once, and both providers' ids begin
 * `evt_`, so the Lob route prefixes its keys.
 */

/** Record an event id, returning false if it has been seen before. */
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

/** Release a recorded event id, so the provider's retry is processed rather than dismissed. */
export async function forgetWebhookEvent(id: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.delete(schema.webhookEvents).where(eq(schema.webhookEvents.id, id));
}
