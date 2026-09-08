import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Stripe from "stripe";

/**
 * The delivery loop, against a real HTTP receiver on loopback.
 *
 * Which means the guard has to be opted out of — so it is set here, before any
 * module that reads `server/env.ts` is imported, and the guard's own behaviour
 * is tested in server/webhooks.test.ts where the default is left in place.
 *
 * docs/tasks/14-outbound-webhooks.md's acceptance list is the spine of this
 * file: a signed order.paid after a payment, a signature that verifies with
 * the README's snippet, backoff and disabling on a failing endpoint, and a
 * Stripe response time that a slow subscriber cannot touch.
 */
process.env.WEBHOOK_ALLOW_INSECURE_TARGETS = "true";

const WEBHOOK_SECRET = "whsec_beluga_fake_webhook_secret";

let app: Express;
let stripe: Stripe;
let receiver: Server;
let base: string;

interface Received {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let received: Received[] = [];
let respond: (req: IncomingMessage, res: ServerResponse) => void;

/** Build a signed Stripe request exactly as Stripe would — same as checkout.test.ts. */
function signedEvent(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  return {
    payload,
    header: stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }),
  };
}

function completedSessionEvent(sessionId: string, orderId: string) {
  return {
    id: `evt_${randomUUID()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_intent: "pi_test_delivery",
        currency: "usd",
        amount_subtotal: 3400,
        amount_total: 3400,
        total_details: { amount_shipping: 0, amount_tax: 0, amount_discount: 0 },
        customer_details: { email: "buyer@example.com", name: "A Buyer" },
        metadata: { beluga_order_id: orderId },
      },
    },
  };
}

/** A pending order sitting on a Stripe session, ready to be paid by a webhook. */
async function pendingOrder(): Promise<{ orderId: string; sessionId: string }> {
  const { createPendingOrder } = await import("../db/orders-repository.js");
  const orderId = randomUUID();
  const sessionId = `cs_test_${orderId}`;

  await createPendingOrder({
    id: orderId,
    checkoutSessionId: sessionId,
    email: "buyer@example.com",
    currency: "USD",
    subtotalCents: 3400,
    lines: [
      {
        productId: "demo-tote",
        variantId: "demo-tote-s",
        productName: "Demo Tote",
        variantLabel: "Small",
        unitPriceCents: 3400,
        quantity: 1,
        options: {},
      },
    ],
  });

  return { orderId, sessionId };
}

/** Backdate a delivery so it is due now, instead of waiting out the backoff. */
async function makeDue(deliveryId: string): Promise<void> {
  const { getDatabase } = await import("../db/client.js");
  const { eq } = await import("drizzle-orm");
  const { drizzle: db, schema, dialect } = await getDatabase();
  const when = new Date(Date.now() - 1000);

  await db
    .update(schema.webhookDeliveries)
    .set({ nextAttemptAt: dialect === "pg" ? when : Math.floor(when.getTime() / 1000) })
    .where(eq(schema.webhookDeliveries.id, deliveryId));
}

async function setStock(variantId: string, quantity: number): Promise<void> {
  const { getDatabase } = await import("../db/client.js");
  const { eq } = await import("drizzle-orm");
  const { drizzle: db, schema } = await getDatabase();

  await db
    .update(schema.variants)
    .set({ inventoryType: "finite", inventoryQuantity: quantity })
    .where(eq(schema.variants.id, variantId));
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");
  const { requireStripe } = await import("./stripe.js");
  const { getDatabase } = await import("../db/client.js");
  const { eq } = await import("drizzle-orm");

  await runMigrations();
  await seedIfEmpty();

  // Publishing is what gives a variant its Stripe price; checkout reads it.
  const { drizzle: db, schema } = await getDatabase();
  await db
    .update(schema.variants)
    .set({ stripePriceId: "price_test_tote_small" })
    .where(eq(schema.variants.id, "demo-tote-s"));

  app = createApp();
  stripe = requireStripe();

  receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      respond(req, res);
    });
  });

  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const address = receiver.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
});

beforeEach(() => {
  received = [];
  respond = (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  };
});

describe("delivery", () => {
  it("sends a signed order.paid that verifies with the README's snippet", async () => {
    const { createEndpoint, listDeliveries } = await import("../db/webhooks-repository.js");
    const { dispatchDueDeliveries } = await import("./webhooks.js");
    const { EVENT_ID_HEADER, SIGNATURE_HEADER } = await import("../shared/webhooks.js");

    const secret = "bwhsec_delivery_probe";
    const endpoint = await createEndpoint({
      url: `${base}/hooks/paid`,
      description: "",
      eventTypes: ["order.paid"],
      enabled: true,
      secret,
    });

    const { orderId, sessionId } = await pendingOrder();
    const { payload, header } = signedEvent(completedSessionEvent(sessionId, orderId));

    await request(app)
      .post("/api/webhooks/stripe")
      .set("content-type", "application/json")
      .set("stripe-signature", header)
      .send(payload)
      .expect(200);

    // Enqueued, not sent: nothing has reached the subscriber yet.
    expect(received).toHaveLength(0);
    const queued = await listDeliveries(endpoint.id, 10);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.deliveredAt).toBeNull();

    await dispatchDueDeliveries();

    expect(received).toHaveLength(1);
    const delivery = received[0]!;

    /*
     * The verification recipe as the README states it, run verbatim: split the
     * header, HMAC `${t}.${body}`, compare. A merchant already verifying Stripe
     * signatures changes the header name and nothing else.
     */
    const signature = delivery.headers[SIGNATURE_HEADER] as string;
    const [timestampPart, signaturePart] = signature.split(",");
    const timestamp = timestampPart!.slice(2);
    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${delivery.body}`)
      .digest("hex");

    expect(signaturePart!.slice(3)).toBe(expected);

    // Fresh enough that a replay window of a few minutes would reject a stale one.
    expect(Math.abs(Date.now() / 1000 - Number(timestamp))).toBeLessThan(60);

    const event = JSON.parse(delivery.body) as {
      id: string;
      type: string;
      data: { id: string; totalCents: number };
    };

    expect(event.type).toBe("order.paid");
    expect(event.data.id).toBe(orderId);
    expect(event.data.totalCents).toBe(3400);
    // The same id in the header, so a consumer can dedup without parsing.
    expect(delivery.headers[EVENT_ID_HEADER]).toBe(event.id);

    const after = await listDeliveries(endpoint.id, 10);
    expect(after[0]!.deliveredAt).not.toBeNull();
    expect(after[0]!.responseStatus).toBe(200);
  });

  it("emits inventory.low for a variant a sale left at the threshold", async () => {
    const { createEndpoint, listDeliveries } = await import("../db/webhooks-repository.js");
    const { LOW_INVENTORY_THRESHOLD } = await import("../shared/webhooks.js");

    const endpoint = await createEndpoint({
      url: `${base}/hooks/inventory`,
      description: "",
      eventTypes: ["inventory.low"],
      enabled: true,
      secret: "bwhsec_inventory",
    });

    await setStock("demo-tote-s", LOW_INVENTORY_THRESHOLD + 1);

    const { orderId, sessionId } = await pendingOrder();
    const { payload, header } = signedEvent(completedSessionEvent(sessionId, orderId));

    await request(app)
      .post("/api/webhooks/stripe")
      .set("content-type", "application/json")
      .set("stripe-signature", header)
      .send(payload)
      .expect(200);

    const deliveries = await listDeliveries(endpoint.id, 10);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.payload).toMatchObject({
      type: "inventory.low",
      data: { variantId: "demo-tote-s", remaining: LOW_INVENTORY_THRESHOLD },
    });
  });

  it("is not in the Stripe webhook's request path, however slow the subscriber", async () => {
    const { createEndpoint, listDeliveries } = await import("../db/webhooks-repository.js");
    const { dispatchDueDeliveries } = await import("./webhooks.js");

    const SUBSCRIBER_DELAY_MS = 1500;
    respond = (_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end("{}");
      }, SUBSCRIBER_DELAY_MS);
    };

    const endpoint = await createEndpoint({
      url: `${base}/hooks/slow`,
      description: "",
      eventTypes: ["order.paid"],
      enabled: true,
      secret: "bwhsec_slow",
    });

    const { orderId, sessionId } = await pendingOrder();
    const { payload, header } = signedEvent(completedSessionEvent(sessionId, orderId));

    const started = Date.now();
    await request(app)
      .post("/api/webhooks/stripe")
      .set("content-type", "application/json")
      .set("stripe-signature", header)
      .send(payload)
      .expect(200);
    const elapsed = Date.now() - started;

    /*
     * The point of the whole queue. If this were sent inline, Stripe would wait
     * out the subscriber, decide we timed out, and retry — re-entering the
     * handler that just processed the payment.
     */
    expect(elapsed).toBeLessThan(SUBSCRIBER_DELAY_MS);
    expect(await listDeliveries(endpoint.id, 10)).toHaveLength(1);

    // And the dispatcher really is talking to a subscriber that slow, so the
    // assertion above is about where the wait happens, not whether it exists.
    const dispatchStarted = Date.now();
    await dispatchDueDeliveries();
    expect(Date.now() - dispatchStarted).toBeGreaterThanOrEqual(SUBSCRIBER_DELAY_MS - 100);
  });
});

describe("retries", () => {
  it("backs off after a failure rather than hammering the endpoint", async () => {
    const { createEndpoint, listDeliveries } = await import("../db/webhooks-repository.js");
    const { dispatchDueDeliveries, emitWebhookEvent } = await import("./webhooks.js");

    respond = (_req, res) => {
      res.writeHead(500);
      res.end("no thanks");
    };

    const endpoint = await createEndpoint({
      url: `${base}/hooks/failing`,
      description: "",
      eventTypes: ["product.published"],
      enabled: true,
      secret: "bwhsec_failing",
    });

    await emitWebhookEvent("product.published", { id: "demo-tote" });
    await dispatchDueDeliveries();

    expect(received).toHaveLength(1);

    const [afterFirst] = await listDeliveries(endpoint.id, 10);
    expect(afterFirst!.attempts).toBe(1);
    expect(afterFirst!.responseStatus).toBe(500);
    expect(afterFirst!.deliveredAt).toBeNull();
    expect(afterFirst!.failedAt).toBeNull();

    // Roughly a minute out — the first step of the backoff.
    expect(afterFirst!.nextAttemptAt).toBeGreaterThan(Date.now() + 30_000);

    // So a tick a moment later sends nothing at all.
    await dispatchDueDeliveries();
    expect(received).toHaveLength(1);

    // Until it comes due again.
    await makeDue(afterFirst!.id);
    await dispatchDueDeliveries();
    expect(received).toHaveLength(2);
    expect((await listDeliveries(endpoint.id, 10))[0]!.attempts).toBe(2);
  });

  it("gives up after the attempt cap and disables the endpoint after a run of them", async () => {
    const { findEndpoint, createEndpoint, listDeliveries } = await import(
      "../db/webhooks-repository.js"
    );
    const { CONSECUTIVE_FAILURE_CAP, MAX_ATTEMPTS, dispatchDueDeliveries, emitWebhookEvent } =
      await import("./webhooks.js");

    respond = (_req, res) => {
      res.writeHead(503);
      res.end("gone");
    };

    const endpoint = await createEndpoint({
      url: `${base}/hooks/dead`,
      description: "",
      eventTypes: ["order.cancelled"],
      enabled: true,
      secret: "bwhsec_dead",
    });

    /*
     * Picked by payload rather than by "the newest row": SQLite stamps
     * `created_at` in whole seconds, so five events emitted in one tick are all
     * the newest, and taking the first would silently re-test one delivery five
     * times.
     */
    const deliveryFor = async (orderId: string) => {
      const all = await listDeliveries(endpoint.id, 50);
      return all.find((row) => (row.payload.data as { id: string }).id === orderId)!;
    };

    for (let event = 0; event < CONSECUTIVE_FAILURE_CAP; event += 1) {
      const orderId = `order-${event}`;
      await emitWebhookEvent("order.cancelled", { id: orderId });

      const queued = await deliveryFor(orderId);

      for (let tries = 0; tries < MAX_ATTEMPTS; tries += 1) {
        await makeDue(queued.id);
        await dispatchDueDeliveries();
      }

      const settled = await deliveryFor(orderId);
      expect(settled.attempts).toBe(MAX_ATTEMPTS);
      expect(settled.failedAt).not.toBeNull();
    }

    const disabled = await findEndpoint(endpoint.id);
    expect(disabled!.enabled).toBe(false);
    expect(disabled!.disabledAt).not.toBeNull();
    expect(disabled!.consecutiveFailures).toBeGreaterThanOrEqual(CONSECUTIVE_FAILURE_CAP);
    expect(disabled!.lastError).toContain("503");

    // And it stays quiet: a disabled endpoint is skipped, not retried forever.
    const before = received.length;
    await emitWebhookEvent("order.cancelled", { id: "order-after-disable" });
    await dispatchDueDeliveries();
    expect(received).toHaveLength(before);
  });

  it("redelivers one delivery on request, and a success clears the failure run", async () => {
    const { findEndpoint, createEndpoint, listDeliveries } = await import(
      "../db/webhooks-repository.js"
    );
    const { dispatchDueDeliveries, emitWebhookEvent } = await import("./webhooks.js");

    respond = (_req, res) => {
      res.writeHead(500);
      res.end();
    };

    const endpoint = await createEndpoint({
      url: `${base}/hooks/redeliver`,
      description: "",
      eventTypes: ["order.updated"],
      enabled: true,
      secret: "bwhsec_redeliver",
    });

    await emitWebhookEvent("order.updated", { id: "order-redeliver" });
    const [queued] = await listDeliveries(endpoint.id, 1);
    await dispatchDueDeliveries();

    expect((await listDeliveries(endpoint.id, 1))[0]!.attempts).toBe(1);

    // The merchant fixes their receiver and asks for this one again.
    respond = (_req, res) => {
      res.writeHead(200);
      res.end("{}");
    };

    const { agent, csrf } = await signInAsAdmin();
    await agent
      .post(`/api/admin/webhooks/deliveries/${queued!.id}/redeliver`)
      .set("x-csrf-token", csrf)
      .expect(200);

    const requeued = (await listDeliveries(endpoint.id, 1))[0]!;
    expect(requeued.attempts).toBe(0);
    expect(requeued.responseStatus).toBeNull();

    await dispatchDueDeliveries();

    const delivered = (await listDeliveries(endpoint.id, 1))[0]!;
    expect(delivered.deliveredAt).not.toBeNull();
    expect(delivered.responseStatus).toBe(200);

    const healthy = await findEndpoint(endpoint.id);
    expect(healthy!.consecutiveFailures).toBe(0);
    expect(healthy!.lastSuccessAt).not.toBeNull();
  });
});

const ADMIN_PASSWORD = "a-sufficiently-long-test-password";
let adminCreated = false;

/** Lazily create the admin — only the redeliver test needs an admin session. */
async function signInAsAdmin() {
  if (!adminCreated) {
    const { createAdmin } = await import("./auth.js");
    await createAdmin("delivery-admin@example.com", ADMIN_PASSWORD);
    adminCreated = true;
  }

  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);

  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email: "delivery-admin@example.com", password: ADMIN_PASSWORD })
    .expect(200);

  return { agent, csrf: login.body.csrfToken as string };
}
