import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Order } from "../shared/orders.js";
import type { Product } from "../shared/schema.js";
import {
  EVENT_ID_HEADER,
  LOW_INVENTORY_THRESHOLD,
  SIGNATURE_HEADER,
  type WebhookEventType,
} from "../shared/webhooks.js";
import {
  claimDelivery,
  endpointsSubscribedTo,
  enqueueDelivery,
  findDueDeliveries,
  findEndpoint,
  markDelivered,
  markFailed,
  recordEndpointFailure,
  recordEndpointSuccess,
  scheduleRetry,
  type WebhookDeliveryRow,
} from "../db/webhooks-repository.js";
import { findLowStockAfterOrder } from "../db/orders-repository.js";
import { env } from "./env.js";

/**
 * Outbound webhooks, the producer half — see docs/tasks/14-outbound-webhooks.md.
 *
 * Built to the same standard as the consumer in server/routes/webhook.ts, which
 * is what Beluga asks of Stripe: signed, deduplicable, at-least-once, retried
 * with backoff. Nothing here ever sends from a request handler —
 * `emitWebhookEvent` inserts delivery rows and returns, and
 * `dispatchDueDeliveries` picks them up on its own tick.
 */

/** Backoff between attempts. Its length sets the attempt cap: 6 in total. */
const RETRY_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  25 * 60_000,
  2 * 60 * 60_000,
  10 * 60 * 60_000,
];

const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

/**
 * Exhausted deliveries in a row before an endpoint is switched off.
 *
 * Counted per *delivery*, not per attempt: one endpoint that is down for an
 * afternoon burns six attempts on the same event, and disabling on that would
 * punish a single blip. Five events that all gave up means the receiver is
 * gone, and retrying forever just fills the queue and the log.
 */
const CONSECUTIVE_FAILURE_CAP = 5;

/** How long a claimed delivery is ours before it becomes due again. */
const LEASE_MS = 60_000;

const REQUEST_TIMEOUT_MS = 10_000;

const DISPATCH_INTERVAL_MS = 10_000;

const DISPATCH_BATCH = 20;

/** A slow subscriber must not be able to make us hold a whole tick. */
const MAX_CONCURRENT_SENDS = 4;

const MAX_REDIRECTS = 3;

/**
 * Payload ceiling.
 *
 * A 300-line order is not something to push down a merchant's throat, and an
 * unbounded body is a way to make our own queue expensive. Over this, the
 * items array is dropped and `truncated` is set — the identifiers are still
 * there, so a subscriber can fetch the rest through its own admin session.
 */
const MAX_PAYLOAD_BYTES = 64 * 1024;

export class EndpointNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EndpointNotAllowedError";
  }
}

/* --------------------------------------------------------------- the guard */

function ipv4IsPrivate(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local — the cloud metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast and reserved, 255.255.255.255 included

  return false;
}

/**
 * Is this address one the host should refuse to talk to?
 *
 * Unknown shapes are treated as private. Getting this wrong in the permissive
 * direction hands an attacker the metadata endpoint; getting it wrong in the
 * strict direction rejects one endpoint URL with a message saying why.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return ipv4IsPrivate(address);
  if (version !== 6) return true;

  const value = address.toLowerCase().split("%")[0] ?? "";

  // ::ffff:127.0.0.1 and the NAT64 prefix both carry a v4 address that is the
  // thing actually reached — check that, not the v6 wrapper.
  const embedded = /(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (embedded?.[1]) return ipv4IsPrivate(embedded[1]);

  if (value === "::" || value === "::1") return true;
  if (/^f[cd]/.test(value)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(value)) return true; // fe80::/10 link-local
  if (/^ff/.test(value)) return true; // multicast
  if (value.startsWith("2001:db8")) return true; // documentation

  return false;
}

/** The self-hoster's opt-out: plain HTTP and loopback targets, deliberately. */
const allowPrivateTargets = env.WEBHOOK_ALLOW_INSECURE_TARGETS;

/**
 * Refuse anything that would make this an SSRF primitive against the host.
 *
 * Checked at endpoint creation *and* immediately before every send, because a
 * hostname that resolved publicly last week can resolve to 169.254.169.254
 * today. A narrow rebinding window remains between this lookup and the socket
 * the fetch opens; closing it entirely means owning the connect path, which is
 * a bigger change than this feature justifies. Re-checking on each hop of a
 * redirect chain is the other half — see `send`.
 */
export async function assertDeliverableUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EndpointNotAllowedError("That is not a valid URL.");
  }

  if (url.protocol !== "https:" && !(allowPrivateTargets && url.protocol === "http:")) {
    throw new EndpointNotAllowedError("Webhook endpoints must use https://.");
  }

  if (allowPrivateTargets) return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");

  let addresses: { address: string }[];
  if (isIP(host)) {
    addresses = [{ address: host }];
  } else {
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new EndpointNotAllowedError(`${url.hostname} does not resolve.`);
    }
  }

  // Every answer must be acceptable, not just the first: a hostname with both
  // a public and a loopback record would otherwise get through on a coin flip.
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new EndpointNotAllowedError(
      `${url.hostname} resolves to a private or reserved address. Webhook endpoints must be publicly reachable — ` +
        "set WEBHOOK_ALLOW_INSECURE_TARGETS=true if this host is deliberately local.",
    );
  }

  return url;
}

/* ------------------------------------------------------------- the signing */

/** A signing key, shown once. Prefixed so it is never confused with Stripe's. */
export function generateSigningSecret(): string {
  return `bwhsec_${randomBytes(32).toString("base64url")}`;
}

/**
 * Stripe's signature shape, deliberately: `t=<unix seconds>,v1=<hex hmac>`
 * over `${t}.${body}`.
 *
 * The timestamp is inside the signed material rather than beside it, which is
 * what makes a replay detectable — a subscriber that rejects an old `t` cannot
 * be fed yesterday's body with today's header.
 */
export function signPayload(secret: string, body: string, timestampSeconds: number): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${body}`)
    .digest("hex");

  return `t=${timestampSeconds},v1=${signature}`;
}

/* ------------------------------------------------------------- the payloads */

/**
 * An order, as a subscriber sees it.
 *
 * Built field by field rather than spread from the row. The order object
 * carries no payment intent, no session and no customer record — and writing
 * the shape out explicitly is what keeps that true when a column is added
 * later. See the redaction assertion in server/webhooks.test.ts.
 */
function orderPayload(order: Order): Record<string, unknown> {
  return {
    id: order.id,
    reference: order.reference,
    email: order.email,
    status: order.status,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
    refundedCents: order.refundedCents,
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
    oversold: order.oversold,
    createdAt: order.createdAt,
    shipping: { ...order.shipping },
    items: order.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      variantLabel: item.variantLabel,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      options: { ...item.options },
    })),
  };
}

function productPayload(product: Product, stripeProductId: string): Record<string, unknown> {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    /*
     * "physical" | "digital". Carried because it is the one thing a fulfilment
     * subscriber must not have to guess: a digital product never ships, and an
     * integration that assumed otherwise would raise a pick list for a download.
     */
    kind: product.kind,
    isLive: product.isLive,
    stripeProductId,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      priceCents: variant.priceCents,
    })),
  };
}

/* ---------------------------------------------------------------- emitting */

interface Envelope {
  id: string;
  type: WebhookEventType;
  created: number;
  data: Record<string, unknown>;
  truncated?: true;
}

/** Drop the heavy part rather than the event. See MAX_PAYLOAD_BYTES. */
function withinSizeCap(envelope: Envelope): Envelope {
  if (Buffer.byteLength(JSON.stringify(envelope), "utf8") <= MAX_PAYLOAD_BYTES) return envelope;

  return {
    ...envelope,
    data: { ...envelope.data, items: [] },
    truncated: true,
  };
}

/**
 * Fan one event out to every subscribed endpoint, then return.
 *
 * Never throws and never sends: the whole point is that a caller on the Stripe
 * webhook's request path pays two inserts, not a merchant's response time. A
 * failure in here is logged and swallowed, because a broken webhook subsystem
 * must not be able to fail an order.
 */
export async function emitWebhookEvent(
  type: WebhookEventType,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const endpoints = await endpointsSubscribedTo(type);
    if (endpoints.length === 0) return;

    // One event id shared by every endpoint's copy: the same event delivered
    // to two subscribers is the same event, and a merchant running both should
    // see one id, exactly as Stripe does it.
    const envelope = withinSizeCap({
      id: `evt_${randomUUID()}`,
      type,
      created: Math.floor(Date.now() / 1000),
      data,
    });

    for (const endpoint of endpoints) {
      await enqueueDelivery({
        endpointId: endpoint.id,
        eventId: envelope.id,
        eventType: type,
        payload: envelope as unknown as Record<string, unknown>,
      });
    }
  } catch (error) {
    console.error(`Could not enqueue the ${type} webhook:`, error);
  }
}

export async function emitOrderEvent(
  type: Extract<
    WebhookEventType,
    "order.paid" | "order.updated" | "order.refunded" | "order.cancelled"
  >,
  order: Order,
): Promise<void> {
  await emitWebhookEvent(type, orderPayload(order));
}

export async function emitProductPublished(
  product: Product,
  stripeProductId: string,
): Promise<void> {
  await emitWebhookEvent("product.published", productPayload(product, stripeProductId));
}

/**
 * One `inventory.low` per finite variant an order pushed to or below the
 * threshold.
 *
 * Emitted from the paid path rather than from the decrement itself, so the
 * numbers reported are the ones that are actually in the database — the
 * decrement is guarded and can decline to move a count at all.
 */
export async function emitLowInventoryAfterOrder(orderId: string): Promise<void> {
  try {
    const low = await findLowStockAfterOrder(orderId, LOW_INVENTORY_THRESHOLD);

    for (const variant of low) {
      await emitWebhookEvent("inventory.low", {
        productId: variant.productId,
        productName: variant.productName,
        variantId: variant.variantId,
        variantLabel: variant.variantLabel,
        remaining: variant.remaining,
        threshold: LOW_INVENTORY_THRESHOLD,
      });
    }
  } catch (error) {
    console.error("Could not enqueue inventory.low webhooks:", error);
  }
}

/* -------------------------------------------------------------- dispatching */

interface SendOutcome {
  ok: boolean;
  status: number | null;
  error: string;
}

/**
 * POST one delivery.
 *
 * Redirects are followed by hand, because `redirect: "follow"` would let a
 * merchant's public endpoint bounce us to 169.254.169.254 with the guard only
 * ever having seen the first hop.
 */
async function send(url: string, body: string, secret: string, eventId: string): Promise<SendOutcome> {
  let target = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let checked: URL;
    try {
      checked = await assertDeliverableUrl(target);
    } catch (error) {
      return { ok: false, status: null, error: (error as Error).message };
    }

    const timestamp = Math.floor(Date.now() / 1000);

    let response: Response;
    try {
      response = await fetch(checked, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          "content-type": "application/json",
          "user-agent": "Beluga-Webhooks/1",
          [SIGNATURE_HEADER]: signPayload(secret, body, timestamp),
          [EVENT_ID_HEADER]: eventId,
        },
        body,
      });
    } catch (error) {
      // Timeouts and DNS/TLS failures land here; all are worth retrying.
      return { ok: false, status: null, error: (error as Error).message };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { ok: false, status: response.status, error: "Redirect without a Location header." };
      }
      target = new URL(location, checked).toString();
      continue;
    }

    // Any 2xx is acceptance. A subscriber that wants to signal a problem should
    // answer non-2xx and get the retry schedule, same as we do with Stripe.
    if (response.ok) return { ok: true, status: response.status, error: "" };

    return { ok: false, status: response.status, error: `Endpoint answered ${response.status}.` };
  }

  return { ok: false, status: null, error: `More than ${MAX_REDIRECTS} redirects.` };
}

/**
 * Attempt one delivery, then record where that leaves it and its endpoint.
 *
 * Claiming happens before any network work, so a lost race costs one UPDATE
 * rather than a duplicate POST — the same ordering as `sendReminder` in
 * server/cart-recovery.ts.
 */
async function attempt(delivery: WebhookDeliveryRow): Promise<void> {
  const endpoint = await findEndpoint(delivery.endpointId);
  if (!endpoint || !endpoint.enabled) return;

  const claimed = await claimDelivery(delivery.id, delivery.attempts, LEASE_MS);
  if (!claimed) return;

  const attemptNumber = delivery.attempts + 1;
  const body = JSON.stringify(delivery.payload);
  const outcome = await send(endpoint.url, body, endpoint.secret, delivery.eventId);

  if (outcome.ok) {
    await markDelivered(delivery.id, outcome.status ?? 200);
    await recordEndpointSuccess(endpoint.id);
    return;
  }

  if (attemptNumber < MAX_ATTEMPTS) {
    const backoff = RETRY_BACKOFF_MS[attemptNumber - 1] ?? RETRY_BACKOFF_MS.at(-1)!;
    await scheduleRetry(delivery.id, {
      responseStatus: outcome.status,
      error: outcome.error,
      nextAttemptAt: new Date(Date.now() + backoff),
    });
    return;
  }

  await markFailed(delivery.id, { responseStatus: outcome.status, error: outcome.error });

  const justDisabled = await recordEndpointFailure(
    endpoint.id,
    outcome.error,
    CONSECUTIVE_FAILURE_CAP,
  );

  if (justDisabled) {
    // Operator-facing on purpose: the admin surfaces this too, but a store
    // whose integration has gone quiet should find the reason in the log.
    console.warn(
      `Disabled webhook endpoint ${endpoint.url} after ${CONSECUTIVE_FAILURE_CAP} failed deliveries. Last error: ${outcome.error}`,
    );
  }
}

/**
 * One pass over the queue. Exported for the tests, which drive it directly
 * rather than waiting on a timer.
 */
export async function dispatchDueDeliveries(): Promise<void> {
  const due = await findDueDeliveries(DISPATCH_BATCH);

  for (let i = 0; i < due.length; i += MAX_CONCURRENT_SENDS) {
    await Promise.all(
      due.slice(i, i + MAX_CONCURRENT_SENDS).map(async (delivery) => {
        try {
          await attempt(delivery);
        } catch (error) {
          // One bad delivery must not stop the rest of the pass. The lease
          // means this row simply comes back round.
          console.error(`Webhook delivery ${delivery.id} threw:`, error);
        }
      }),
    );
  }
}

/**
 * The dispatcher.
 *
 * Same shape and the same reasoning as `startCartRecoveryScheduler` in
 * server/cart-recovery.ts — an unref'd `setInterval` in the API process,
 * honest about running per-instance. Task 12 landed first and established
 * that pattern, so this reuses it rather than introducing a second one; what
 * makes two instances safe is not the timer but `claimDelivery`'s conditional
 * update, which only one of two racing ticks can win.
 *
 * Ten seconds rather than the sweep's fifteen minutes: this is the latency a
 * subscriber sees between a sale and being told about it.
 */
export function startWebhookDispatcher(): { close: () => void } {
  const timer = setInterval(() => void dispatchDueDeliveries(), DISPATCH_INTERVAL_MS);
  timer.unref();
  return { close: () => clearInterval(timer) };
}

export { CONSECUTIVE_FAILURE_CAP, MAX_ATTEMPTS };
