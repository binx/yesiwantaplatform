import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

/** Turn the store's tax collection on or off, as Settings would. */
async function setTax(enabled: boolean, behavior: "exclusive" | "inclusive" = "exclusive") {
  const { getDatabase } = await import("../db/client.js");
  const { drizzle: db, schema } = await getDatabase();
  await db
    .update(schema.storeSettings)
    .set({ taxEnabled: enabled, taxBehavior: behavior })
    .where(eq(schema.storeSettings.id, 1));
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
  discount?: number;
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
        total_details: {
          amount_shipping: overrides.shipping ?? 0,
          amount_tax: 0,
          amount_discount: overrides.discount ?? 0,
        },
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

  it("charges the real price for a variant on sale, never the compare-at price", async () => {
    await publishVariant("demo-tote-l", "price_test_tote_large");

    const response = await request(app)
      .post("/api/checkout")
      .send({
        lines: [{ productId: "demo-tote", variantId: "demo-tote-l", quantity: 1, options: {} }],
      })
      .expect(200);

    expect(response.body.url).toContain("checkout.stripe.com");

    // demo-tote-l is seeded with priceCents 4200 and compareAtPriceCents
    // 4800 — the 4800 must appear nowhere in what Stripe or the order see.
    const params = createSession.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
    expect(JSON.stringify(params)).not.toContain("4800");

    const { findOrderByCheckoutSession } = await import("../db/orders-repository.js");
    const session = createSession.mock.results[0]?.value as { id: string };
    const order = await findOrderByCheckoutSession(session.id);
    expect(order?.items[0]?.unitPriceCents).toBe(4200);
    expect(order?.subtotalCents).toBe(4200);
  });

  it("lets Stripe host the promotion-code field", async () => {
    await request(app)
      .post("/api/checkout")
      .send({ lines: [{ productId: "demo-tote", variantId: "demo-tote-s", quantity: 1 }] })
      .expect(200);

    const params = createSession.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
    expect(params.allow_promotion_codes).toBe(true);
    // Stripe rejects the two together, so this must never appear alongside it.
    expect(params.discounts).toBeUndefined();
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

    // What the shopper is told: the fact, not the merchant's plumbing. Naming
    // Stripe here told a buyer about a relationship they do not have.
    expect(response.body.error).toBe("Silk Scarf is unavailable right now.");
    expect(response.body.error).not.toMatch(/Stripe/);
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

/**
 * Digital products at checkout — see docs/tasks/13-digital-products.md.
 *
 * The failure this guards is not an error but a form field: a buyer asked for
 * a postal address to receive a PDF, and a Stripe session carrying a shipping
 * address for an order with nothing to ship.
 */
describe("digital products at checkout", () => {
  /** Mark a seeded product digital, as the admin's Type control would. */
  async function setKind(productId: string, kind: "physical" | "digital") {
    const { getDatabase } = await import("../db/client.js");
    const { drizzle: db, schema } = await getDatabase();
    await db.update(schema.products).set({ kind }).where(eq(schema.products.id, productId));
  }

  beforeEach(async () => {
    await setKind("demo-mug", "digital");
  });

  // Put it back: the seeded mug is physical everywhere else in this file, and
  // a describe that leaves the fixture changed makes the suite order-dependent.
  afterEach(async () => {
    await setKind("demo-mug", "physical");
  });

  async function checkoutWith(lines: unknown[]): Promise<Stripe.Checkout.SessionCreateParams> {
    await request(app).post("/api/checkout").send({ lines }).expect(200);
    return createSession.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
  }

  it("collects no address and offers no shipping for a cart of downloads", async () => {
    const params = await checkoutWith([
      { productId: "demo-mug", variantId: "demo-mug-default", quantity: 1 },
    ]);

    // Absent entirely, not an empty list: an empty `allowed_countries` is a
    // Stripe error, and an empty `shipping_options` still renders the section.
    expect(params.shipping_address_collection).toBeUndefined();
    expect(params.shipping_options).toBeUndefined();
  });

  it("still collects an address when one physical line is in the cart", async () => {
    const params = await checkoutWith([
      { productId: "demo-mug", variantId: "demo-mug-default", quantity: 1 },
      { productId: "demo-tote", variantId: "demo-tote-s", quantity: 1 },
    ]);

    expect(params.shipping_address_collection).toBeDefined();
  });

  it("ignores a shipToCountry the buyer sends for a downloads-only cart", async () => {
    await request(app)
      .post("/api/checkout")
      .send({
        lines: [{ productId: "demo-mug", variantId: "demo-mug-default", quantity: 1 }],
        shipToCountry: "US",
      })
      .expect(200);

    const params = createSession.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
    expect(params.shipping_address_collection).toBeUndefined();
  });

  it("prices a mixed cart on the physical line only", async () => {
    const { quoteShipping } = await import("./routes/shipping.js");

    const mixed = await quoteShipping(
      [
        { productId: "demo-mug", variantId: "demo-mug-default", quantity: 1 },
        { productId: "demo-tote", variantId: "demo-tote-s", quantity: 1 },
      ],
      "US",
    );
    const physicalOnly = await quoteShipping(
      [{ productId: "demo-tote", variantId: "demo-tote-s", quantity: 1 }],
      "US",
    );

    // Adding a download to the cart changes neither the parcel nor its price.
    expect(mixed.weightGrams).toBe(physicalOnly.weightGrams);
    expect(mixed.subtotalCents).toBe(physicalOnly.subtotalCents);
    expect(mixed.requiresShipping).toBe(true);
  });

  it("reports a downloads-only cart as needing no shipping, and not as a gap", async () => {
    const { quoteShipping } = await import("./routes/shipping.js");

    const quote = await quoteShipping(
      [{ productId: "demo-mug", variantId: "demo-mug-default", quantity: 1 }],
      "US",
    );

    expect(quote.requiresShipping).toBe(false);
    expect(quote.rates).toEqual([]);
    // A gap means "the merchant has a hole in their table"; this is not one.
    expect(quote.gap).toBe(false);
  });
});

describe("tax at checkout", () => {
  async function checkout(): Promise<Stripe.Checkout.SessionCreateParams> {
    await request(app)
      .post("/api/checkout")
      .send({ lines: [{ productId: "demo-tote", variantId: "demo-tote-s", quantity: 1 }] })
      .expect(200);

    return createSession.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
  }

  it("sends no tax keys at all when the store does not collect tax", async () => {
    await setTax(false);
    const params = await checkout();

    // Not "enabled: false" — absent. A store that collects no tax should
    // produce exactly the session it produced before this feature existed.
    expect(params.automatic_tax).toBeUndefined();
    expect(params.customer_update).toBeUndefined();
  });

  it("enables automatic tax, with the customer_update Stripe requires", async () => {
    await setTax(true);
    const params = await checkout();

    expect(params.automatic_tax).toEqual({ enabled: true });
    /*
     * Not optional. With automatic_tax on, a session that creates a customer is
     * rejected at *creation* without this — so leaving it out would take the
     * store's checkout down entirely rather than merely mis-taxing an order.
     */
    expect(params.customer_update).toEqual({ shipping: "auto" });

    await setTax(false);
  });

  it("declares a tax behaviour on shipping only while tax is on", async () => {
    const { replaceShippingTable } = await import("../db/shipping-repository.js");
    await replaceShippingTable({
      zones: [{ id: "z1", name: "US", countryCodes: ["US"] }],
      rates: [
        {
          id: "r1",
          name: "Standard",
          priceCents: 500,
          zoneId: "z1",
          minWeightGrams: null,
          maxWeightGrams: null,
          minSubtotalCents: null,
          maxSubtotalCents: null,
          taxBehavior: "inclusive",
          isActive: true,
        },
      ],
    });

    await setTax(true);
    await request(app)
      .post("/api/checkout")
      .send({
        lines: [{ productId: "demo-tote", variantId: "demo-tote-s", quantity: 1 }],
        shipToCountry: "US",
      })
      .expect(200);

    const withTax = createSession.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
    expect(withTax.shipping_options?.[0]?.shipping_rate_data?.tax_behavior).toBe("inclusive");

    await setTax(false);
    createSession.mockClear();

    await request(app)
      .post("/api/checkout")
      .send({
        lines: [{ productId: "demo-tote", variantId: "demo-tote-s", quantity: 1 }],
        shipToCountry: "US",
      })
      .expect(200);

    const without = createSession.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
    expect(without.shipping_options?.[0]?.shipping_rate_data?.tax_behavior).toBeUndefined();

    await replaceShippingTable({ zones: [], rates: [] });
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

  it("records a promotion code's discount without touching the subtotal", async () => {
    const { sessionId, orderId } = await startCheckout("demo-tote-s", "demo-tote");

    // Stripe's amount_subtotal is pre-discount and amount_total post-discount.
    const { payload, header } = signedEvent(
      completedSessionEvent({
        sessionId,
        orderId,
        amountSubtotal: 3400,
        amountTotal: 2900,
        discount: 500,
      }),
    );

    await request(app)
      .post("/api/webhooks/stripe")
      .set("content-type", "application/json")
      .set("stripe-signature", header)
      .send(payload)
      .expect(200);

    const { getOrder } = await import("../db/orders-repository.js");
    const order = await getOrder(orderId);

    expect(order?.discountCents).toBe(500);
    // Deducting on the way in would double-count it against amount_total.
    expect(order?.subtotalCents).toBe(3400);
    expect(order?.totalCents).toBe(2900);
  });

  it("records zero, not null, when no code was used", async () => {
    const { sessionId, orderId } = await startCheckout("demo-tote-s", "demo-tote");
    const { payload, header } = signedEvent(completedSessionEvent({ sessionId, orderId }));

    await request(app)
      .post("/api/webhooks/stripe")
      .set("content-type", "application/json")
      .set("stripe-signature", header)
      .send(payload)
      .expect(200);

    const { getOrder } = await import("../db/orders-repository.js");
    expect((await getOrder(orderId))?.discountCents).toBe(0);
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
