import { createHmac } from "node:crypto";
import { Router, raw } from "express";
import { z } from "zod";
import { findPostcardForTracking, forgetWebhookEvent, recordTrackingEvent, recordWebhookEvent, markPostcardReturned } from "../../db/orders-repository.js";
import { safeEqual } from "../auth.js";
import { env, hasLobWebhook } from "../env.js";

/**
 * Lob's tracking webhook — where a card is, after it left.
 *
 * Verified the way Lob signs: `Lob-Signature` is the hex HMAC-SHA256 of
 * `${Lob-Signature-Timestamp}.${raw body}` under the webhook's own secret,
 * so this is mounted before the JSON body parser, like the Stripe one, and
 * reads the exact bytes. Events are deduplicated in the same table as
 * Stripe's, prefixed, because both providers' ids begin `evt_`.
 *
 * Nothing here sends an email. The timeline lives on the order pages the
 * buyer already has; a day-by-day feed of USPS scans is noise.
 */
export const lobWebhookRouter: Router = Router();

/** How stale a signed timestamp may be before it is refused: a replay window, not a clock-skew allowance. */
const TOLERANCE_MS = 5 * 60 * 1000;

const eventSchema = z.object({
  id: z.string().min(1),
  event_type: z.object({ id: z.string().min(1) }),
  reference_id: z.string().nullable().optional(),
  date_created: z.string().optional(),
  body: z
    .object({
      id: z.string().optional(),
      metadata: z.record(z.string(), z.string()).optional(),
      tracking_events: z
        .array(
          z.object({
            name: z.string().optional(),
            location: z.string().nullable().optional(),
            time: z.string().nullable().optional(),
          }),
        )
        .optional(),
    })
    .passthrough()
    .optional(),
});

/** Lob's timestamp header is epoch milliseconds; a value that looks like seconds is taken as seconds. */
function timestampMs(header: string): number | null {
  if (!/^\d+$/.test(header)) return null;
  const value = Number(header);
  return value < 1e12 ? value * 1000 : value;
}

export function verifyLobSignature(secret: string, timestamp: string, body: Buffer, signature: string): boolean {
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
  return safeEqual(expected, signature.trim().toLowerCase());
}

lobWebhookRouter.post("/webhooks/lob", raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  if (!hasLobWebhook || !env.LOB_WEBHOOK_SECRET) {
    res.status(503).json({ error: "Lob webhooks are not configured." });
    return;
  }

  const signature = req.get("lob-signature");
  const timestamp = req.get("lob-signature-timestamp");
  if (!signature || !timestamp) {
    res.status(400).json({ error: "Missing Lob signature." });
    return;
  }

  const at = timestampMs(timestamp);
  if (at === null || Math.abs(Date.now() - at) > TOLERANCE_MS) {
    res.status(400).json({ error: "Stale Lob signature." });
    return;
  }

  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!verifyLobSignature(env.LOB_WEBHOOK_SECRET, timestamp, body, signature)) {
    console.warn("Rejected a Lob webhook with an invalid signature.");
    res.status(400).json({ error: "Invalid signature." });
    return;
  }

  let event: z.infer<typeof eventSchema>;
  try {
    event = eventSchema.parse(JSON.parse(body.toString("utf8")));
  } catch {
    res.status(400).json({ error: "Unreadable event." });
    return;
  }

  // Lob delivers at least once, and both providers' ids begin `evt_`.
  const dedupeKey = `lob:${event.id}`;
  const isNew = await recordWebhookEvent(dedupeKey, event.event_type.id);
  if (!isNew) {
    res.json({ received: true, duplicate: true });
    return;
  }

  try {
    const type = event.event_type.id;
    if (!type.startsWith("postcard.")) {
      // Letters, checks, anything else this account might send: not ours.
      res.json({ received: true, ignored: true });
      return;
    }

    const postcard = await findPostcardForTracking(event.body?.metadata?.postcard_id ?? null, event.body?.id ?? event.reference_id ?? null);
    if (!postcard) {
      // Acknowledged: Lob would otherwise retry a card this database never had
      // — a test card from the admin, or one from another store on the key.
      console.warn(`Lob tracking event ${event.id} (${type}) for a postcard this store does not know.`);
      res.json({ received: true, unknown: true });
      return;
    }

    const occurredAt = event.date_created ? Date.parse(event.date_created) : Number.NaN;
    const latestScan = event.body?.tracking_events?.at(-1);
    await recordTrackingEvent(postcard.id, {
      id: event.id,
      type,
      occurredAt: Number.isNaN(occurredAt) ? at : occurredAt,
      location: latestScan?.location ?? null,
    });

    // Our words, not a Lob refusal: the admin's error column is where a
    // person looks, and a returned card is the earliest sign of a bad address.
    if (type === "postcard.returned_to_sender") await markPostcardReturned(postcard.id);
  } catch (error) {
    await forgetWebhookEvent(dedupeKey);
    console.error(`Failed handling Lob event ${event.id}:`, error);
    res.status(500).json({ error: "Handler failed." });
    return;
  }

  res.json({ received: true });
});
