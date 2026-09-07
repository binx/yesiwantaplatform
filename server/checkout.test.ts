import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";

/**
 * Checkout and webhooks.
 *
 * Stripe's network calls are stubbed, but signature verification is the real
 * implementation — that is pure crypto, so the security-critical path is
 * genuinely exercised rather than mocked away.
 */

let app: Express;
let stripe: Stripe;
let createSession: ReturnType<typeof vi.fn>;

const WEBHOOK_SECRET = "whsec_beluga_fake_webhook_secret";

/** Give a variant a Stripe price id, as publishing would. */
async function publishVariant(variantId: string, priceId: string) {
  const { getDatabase } = await import("../db/client.js");
  const { drizzle: db, schema } = await getDatabase();
  await db
    .update(schema.variants)
    .set({ stripePriceId: priceId })
    .where(eq(schema.variants.id, variantId));
}

async function setStock(variantId: string, quantity: number) {
  const { getDatabase } = await import("../db/client.js");
  const { drizzle: db, schema } = await getDatabase();
  await db
    .update(schema.variants)
    .set({ inventoryType: "finite", inventoryQuantity: quantity })
    .where(eq(schema.variants.id, variantId));
}

async function stockOf(variantId: string): Promise<number> {
  const { getDatabase } = await import("../db/client.js");
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ q: schema.variants.inventoryQuantity })
    .from(schema.variants)
    .where(eq(schema.variants.id, variantId))
    .limit(1)) as unknown as { q: number }[];
  return rows[0]?.q ?? -1;
}

/** Build a signed webhook request exactly as Stripe would. */
function signedEvent(event: Record<string, unknown>) {
  // Sent as a string, not a Buffer: superagent would JSON-encode a Buffer and
  // the bytes would no longer match the signature.
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, header };
}

function completedSessionEvent(overrides: {
  id?: string;
  sessionId: string;
  orderId: string;
  amountSubtotal?: number;
  amountTotal?: number;
  shipping?: number;
}) {
  return {
    id: overrides.id ?? `evt_${Math.random().toString(36).slice(2)}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: overrides.sessionId,
        object: "checkout.session",
        payment_intent: "pi_test_123",
        currency: "usd",
        amount_subtotal: overrides.amountSubtotal ?? 3400,
        amount_total: overrides.amountTotal ?? 3400,
        total_details: { amount_shipping: overrides.shipping ?? 0, amount_tax: 0 },
        customer_details: { email: "buyer@example.com", name: "A Buyer" },
        collected_information: {
          shipping_details: {
            name: "A Buyer",
            address: {
              line1: "1 Test Street",
              line2: null,
              city: "Marfa",
              state: "TX",
              postal_code: "79843",
              country: "US",
            },
          },
        },
        metadata: { beluga_order_id: overrides.orderId },
      },
    },
  };
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");
  const { requireStripe } = await import("./stripe.js");

  await runMigrations();
  await seedIfEmpty();

  app = createApp();
  stripe = requireStripe();

  await publishVariant("demo-tote-s", "price_test_tote_small");
  await publishVariant("demo-mug-default", "price_test_mug");
});

beforeEach(() => {
  // Only the network call is stubbed.
  createSession = vi.fn().mockImplementation((params: Stripe.Checkout.SessionCreateParams) => ({
    id: `cs_test_${Math.random().toString(36).slice(2)}`,
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
    line_items: params.line_items,
  }));
  vi.spyOn(stripe.checkout.sessions, "create").mockImplementation(
    createSession as unknown as typeof stripe.checkout.sessions.create,
  );
});

describe("checkout", () => {
  it("prices the order from the database, ignoring anything the client sends", async () => {
    const response = await request(app)
      .post("/api/checkout")
      .send({
        lines: [
          {
            productId: "demo-tote",
            variantId: "demo-tote-s",
            quantity: 2,
            options: {},
            // A tampered client trying to set its own price.
            priceCents: 1,
            unitPriceCents: 1,
          },
        ],
      })
      .expect(200);

    expect(response.body.url).toContain("checkout.stripe.com");

    // Stripe receives a price *id*, never an amount from the request.
    const params = createSession.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
    expect(params.line_items).toEqual([{ price: "price_test_tote_small", quantity: 2 }]);
    expect(JSON.stringify(params.line_items)).not.toContain("unit_amount");

    // And the order we recorded uses the catalogue price, not the sent one.
    const { findOrderByCheckoutSession } = await import("../db/orders-repository.js");
    const session = createSession.mock.results[0]?.value as { id: string };
    const order = await findOrderByCheckoutSession(session.id);
    expect(order?.items[0]?.unitPriceCents).toBe(3400);
  });

  it("refuses to sell more than is in stock", async () => {
    await setStock("demo-tote-s", 1);

    const response = await request(app)
      .post("/api/checkout")
      .send({ lines: [{ productId: "demo-tote", variantId: "demo-tote-s", quantity: 5 }] })
      .expect(409);

    expect(response.body.error).toMatch(/Only 1/);
    await setStock("demo-tote-s", 12);
  });

  it("refuses a product that has not been published to Stripe", async () => {
    const response = await request(app)
      .post("/api/checkout")
      .send({ lines: [{ productId: "demo-scarf", variantId: "demo-scarf-rust", quantity: 1 }] })
      .expect(409);

    expect(response.body.error).toMatch(/not published to Stripe/);
  });

  it("refuses a draft or unknown product", async () => {
    await request(app)
      .post("/api/checkout")
      .send({ lines: [{ productId: "does-not-exist", variantId: "x", quantity: 1 }] })
      .expect(409);
  });

  it("rejects a malformed cart", async () => {
    await request(app).post("/api/checkout").send({ lines: [] }).expect(400);
    await request(app)
      .post("/api/checkout")
      .send({ lines: [{ productId: "demo-tote", variantId: "demo-tote-s", quantity: 0 }] })
      .expect(400);
  });
});

describe("webhooks", () => {
  async function startCheckout(variantId = "demo-mug-default", productId = "demo-mug") {
    await request(app)
      .post("/api/checkout")
      .send({ lines: [{ productId, variantId, quantity: 1 }] })
      .expect(200);

    const session = createSession.mock.results[0]?.value as { id: string };
    const params = createSession.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
    return { sessionId: session.id, orderId: params.metadata?.beluga_order_id as string };
  }

  it("rejects an unsigned request", async () => {
    await request(app)
      .post("/api/webhooks/stripe")
      .set("content-type", "application/json")
      .send(JSON.stringify({ id: "evt_1", type: "checkout.session.completed" }))
      .expect(400);
  });

  it("rejects a forged signature", async () => {
    const { payload } = signedEvent({ id: "evt_forged", type: "checkout.session.completed" });

    await request(app)
      .post("/api/webhooks/stripe")
      .set("content-type", "application/json")
      .set("stripe-signature", "t=1,v1=deadbeef")
      .send(payload)
      .expect(400);
  });

  it("marks the order paid and decrements stock", async () => {
    const { sessionId, orderId } = await startCheckout("demo-tote-s", "demo-tote");
    const before = await stockOf("demo-tote-s");

    const { payload, header } = signedEvent(
      completedSessionEvent({ sessionId, orderId, amountSubtotal: 3400, amountTotal: 3900, shipping: 500 }),
    );

    await request(app)
      .post("/api/webhooks/stripe")
      .set("content-type", "application/json")
      .set("stripe-signature", header)
      .send(payload)
      .expect(200);

    const { getOrder } = await import("../db/orders-repository.js");
    const order = await getOrder(orderId);

    expect(order?.status).toBe("paid");
    expect(order?.email).toBe("buyer@example.com");
    // Totals come from Stripe, which is the authority on what was charged.
    expect(order?.totalCents).toBe(3900);
    expect(order?.shippingCents).toBe(500);
    expect(order?.shipping.city).toBe("Marfa");

    expect(await stockOf("demo-tote-s")).toBe(before - 1);
  });

  it("is idempotent: a replayed event does not decrement twice", async () => {
    const { sessionId, orderId } = await startCheckout("demo-tote-s", "demo-tote");
    const before = await stockOf("demo-tote-s");

    const event = completedSessionEvent({ id: "evt_replay_me", sessionId, orderId });
    const { payload, header } = signedEvent(event);

    const send = () =>
      request(app)
        .post("/api/webhooks/stripe")
        .set("content-type", "application/json")
        .set("stripe-signature", header)
        .send(payload);

    await send().expect(200);
    const second = await send().expect(200);

    expect(second.body.duplicate).toBe(true);
    // Stripe delivers at least once; without dedup this would be before - 2.
    expect(await stockOf("demo-tote-s")).toBe(before - 1);
  });

  it("records the order and flags it rather than overselling", async () => {
    const { sessionId, orderId } = await startCheckout("demo-tote-s", "demo-tote");

    // Stock disappears between checkout and payment confirmation.
    await setStock("demo-tote-s", 0);

    const { payload, header } = signedEvent(completedSessionEvent({ sessionId, orderId }));

    await request(app)
      .post("/api/webhooks/stripe")
      .set("content-type", "application/json")
      .set("stripe-signature", header)
      .send(payload)
      .expect(200);

    const { getOrder } = await import("../db/orders-repository.js");
    const order = await getOrder(orderId);

    // The money was taken, so the order stands — flagged, not silently lost.
    expect(order?.status).toBe("paid");
    expect(order?.oversold).toBe(true);
    // And stock never goes negative.
    expect(await stockOf("demo-tote-s")).toBe(0);

    await setStock("demo-tote-s", 12);
  });

  it("acknowledges an event type it does not handle", async () => {
    const { payload, header } = signedEvent({
      id: "evt_unhandled",
      object: "event",
      type: "customer.created",
      data: { object: { id: "cus_1" } },
    });

    await request(app)
      .post("/api/webhooks/stripe")
      .set("content-type", "application/json")
      .set("stripe-signature", header)
      .send(payload)
      .expect(200);
  });
});
