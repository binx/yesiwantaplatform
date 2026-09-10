import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Stripe from "stripe";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { addDaysIso, todayIso } from "../shared/postcards.js";
import type { Order } from "../shared/orders.js";

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

const WEBHOOK_SECRET = "whsec_postcards_fake_webhook_secret";

const RECIPIENT = { name: "Grandma", line1: "1 Test Street", line2: null, city: "Marfa", state: "TX", postalCode: "79843" };

/** A saved design, through the real upload route. */
async function design(): Promise<string> {
  const png = await sharp({ create: { width: 200, height: 300, channels: 3, background: "#ff00ff" } }).png().toBuffer();
  const response = await request(app)
    .post("/api/designs")
    .field("orientation", "portrait")
    .field("back", JSON.stringify({ text: "Hello from the test suite" }))
    .attach("file", png, { filename: "a.png", contentType: "image/png" })
    .expect(201);
  return response.body.id as string;
}

async function setPrice(cents: number) {
  const { getDatabase } = await import("../db/client.js");
  const { drizzle: db, schema } = await getDatabase();
  await db.update(schema.storeSettings).set({ postcardPriceCents: cents }).where(eq(schema.storeSettings.id, 1));
}

function signedEvent(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, header };
}

function sendEvent(event: Record<string, unknown>) {
  const { payload, header } = signedEvent(event);
  return request(app)
    .post("/api/webhooks/stripe")
    .set("content-type", "application/json")
    .set("stripe-signature", header)
    .send(payload);
}

function completedSessionEvent(o: { id?: string; sessionId: string; orderId: string; amountTotal?: number; discount?: number }) {
  return {
    id: o.id ?? `evt_${Math.random().toString(36).slice(2)}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: o.sessionId,
        object: "checkout.session",
        payment_intent: `pi_${o.orderId}`,
        currency: "usd",
        amount_subtotal: 280,
        amount_total: o.amountTotal ?? 280,
        total_details: { amount_shipping: 0, amount_tax: 0, amount_discount: o.discount ?? 0 },
        customer_details: { email: "buyer@example.com", name: "A Buyer" },
        metadata: { postcards_order_id: o.orderId },
      },
    },
  };
}

async function startCheckout(lines: unknown) {
  await request(app).post("/api/checkout").send({ lines }).expect(200);
  const session = createSession.mock.results.at(-1)?.value as { id: string };
  const params = createSession.mock.calls.at(-1)?.[0] as Stripe.Checkout.SessionCreateParams;
  return { sessionId: session.id, orderId: params.metadata?.postcards_order_id as string, params };
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
});

beforeEach(() => {
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
  it("prices the order from settings, ignoring anything the client sends", async () => {
    await setPrice(140);
    const designId = await design();
    const today = todayIso();

    const { params, sessionId } = await startCheckout([
      {
        designs: [{ designId, mailDate: today }, { designId, mailDate: addDaysIso(today, 7) }],
        recipients: [RECIPIENT, { ...RECIPIENT, name: "Grandpa" }],
        // A tampered client trying to set its own price.
        priceCents: 1,
        unitPriceCents: 1,
      },
    ]);

    // 2 designs × 2 recipients = 4 cards, at the settings price.
    const line = params.line_items?.[0];
    expect(line?.quantity).toBe(4);
    expect(line?.price_data?.unit_amount).toBe(140);
    expect(params.shipping_address_collection).toBeUndefined();
    expect(params.allow_promotion_codes).toBe(true);

    const { findOrderByCheckoutSession } = await import("../db/orders-repository.js");
    const order = await findOrderByCheckoutSession(sessionId);
    expect(order?.unitPriceCents).toBe(140);
    expect(order?.postcardCount).toBe(4);
    expect(order?.subtotalCents).toBe(560);
    expect(order?.postcards).toHaveLength(4);
    expect(order?.postcards.every((p) => p.status === "pending")).toBe(true);
  });

  it("charges the current price, not the one the cart was built under", async () => {
    await setPrice(200);
    const designId = await design();
    const { params } = await startCheckout([{ designs: [{ designId, mailDate: todayIso() }], recipients: [RECIPIENT] }]);
    expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(200);
    await setPrice(140);
  });

  it("refuses a design that does not exist", async () => {
    const response = await request(app)
      .post("/api/checkout")
      .send({ lines: [{ designs: [{ designId: "nope", mailDate: todayIso() }], recipients: [RECIPIENT] }] })
      .expect(409);
    expect(response.body.error).toMatch(/no longer available/i);
  });

  it("refuses a mail date in the past", async () => {
    const designId = await design();
    await request(app)
      .post("/api/checkout")
      .send({ lines: [{ designs: [{ designId, mailDate: "2020-01-01" }], recipients: [RECIPIENT] }] })
      .expect(400);
  });

  it("refuses a recipient Lob could not print", async () => {
    const designId = await design();
    await request(app)
      .post("/api/checkout")
      .send({
        lines: [{ designs: [{ designId, mailDate: todayIso() }], recipients: [{ ...RECIPIENT, name: "A name far too long for the front of any postcard at all" }] }],
      })
      .expect(400);
    await request(app)
      .post("/api/checkout")
      .send({ lines: [{ designs: [{ designId, mailDate: todayIso() }], recipients: [{ ...RECIPIENT, postalCode: "ABCDE" }] }] })
      .expect(400);
  });

  it("rejects a malformed cart", async () => {
    await request(app).post("/api/checkout").send({ lines: [] }).expect(400);
  });
});

describe("webhooks", () => {
  it("rejects an unsigned request", async () => {
    await request(app)
      .post("/api/webhooks/stripe")
      .set("content-type", "application/json")
      .send(JSON.stringify({ id: "evt_1", type: "checkout.session.completed" }))
      .expect(400);
  });

  it("marks the order paid, schedules every card, and claims the designs", async () => {
    const designId = await design();
    const { sessionId, orderId } = await startCheckout([{ designs: [{ designId, mailDate: addDaysIso(todayIso(), 3) }], recipients: [RECIPIENT, { ...RECIPIENT, name: "Grandpa" }] }]);

    await sendEvent(completedSessionEvent({ sessionId, orderId })).expect(200);

    const { getOrder } = await import("../db/orders-repository.js");
    const order = await getOrder(orderId);
    expect(order?.status).toBe("paid");
    expect(order?.email).toBe("buyer@example.com");
    expect(order?.postcards.every((p) => p.status === "scheduled")).toBe(true);

    const { getDesign } = await import("../db/designs-repository.js");
    expect((await getDesign(designId))?.orderId).toBe(orderId);
  });

  it("is idempotent: a replayed event is acknowledged as a duplicate", async () => {
    const designId = await design();
    const { sessionId, orderId } = await startCheckout([{ designs: [{ designId, mailDate: todayIso() }], recipients: [RECIPIENT] }]);
    const event = completedSessionEvent({ id: "evt_replay_me", sessionId, orderId });

    await sendEvent(event).expect(200);
    const second = await sendEvent(event).expect(200);
    expect(second.body.duplicate).toBe(true);
  });

  it("records a promotion code's discount without touching the subtotal", async () => {
    const designId = await design();
    const { sessionId, orderId } = await startCheckout([{ designs: [{ designId, mailDate: todayIso() }], recipients: [RECIPIENT, RECIPIENT] }]);

    await sendEvent(completedSessionEvent({ sessionId, orderId, amountTotal: 230, discount: 50 })).expect(200);

    const { getOrder } = await import("../db/orders-repository.js");
    const order = await getOrder(orderId);
    expect(order?.discountCents).toBe(50);
    expect(order?.subtotalCents).toBe(280);
    expect(order?.totalCents).toBe(230);
  });

  it("cancels an expired checkout's cards without charging anyone", async () => {
    const designId = await design();
    const { sessionId, orderId } = await startCheckout([{ designs: [{ designId, mailDate: todayIso() }], recipients: [RECIPIENT] }]);

    await sendEvent({
      id: `evt_expired_${orderId}`,
      object: "event",
      type: "checkout.session.expired",
      data: { object: { id: sessionId, object: "checkout.session", metadata: { postcards_order_id: orderId } } },
    }).expect(200);

    const { getOrder } = await import("../db/orders-repository.js");
    const order = await getOrder(orderId);
    expect(order?.status).toBe("cancelled");
    expect(order?.postcards.every((p) => p.status === "cancelled")).toBe(true);
  });

  it("withdraws unsent cards on a full refund, and leaves them on a partial one", async () => {
    const designId = await design();
    const { sessionId, orderId } = await startCheckout([{ designs: [{ designId, mailDate: addDaysIso(todayIso(), 10) }], recipients: [RECIPIENT, RECIPIENT] }]);
    await sendEvent(completedSessionEvent({ sessionId, orderId })).expect(200);

    const refund = (amountRefunded: number, id: string) => ({
      id,
      object: "event",
      type: "charge.refunded",
      data: { object: { id: "ch_1", object: "charge", amount: 280, amount_refunded: amountRefunded, metadata: { postcards_order_id: orderId } } },
    });

    await sendEvent(refund(140, `evt_partial_${orderId}`)).expect(200);
    const { getOrder } = await import("../db/orders-repository.js");
    let order = await getOrder(orderId);
    expect(order?.refundedCents).toBe(140);
    expect(order?.status).toBe("paid");
    expect(order?.postcards.every((p) => p.status === "scheduled")).toBe(true);

    await sendEvent(refund(280, `evt_full_${orderId}`)).expect(200);
    order = await getOrder(orderId);
    expect(order?.refundedCents).toBe(280);
    expect(order?.status).toBe("refunded");
    expect(order?.postcards.every((p) => p.status === "cancelled")).toBe(true);
  });

  it("acknowledges an event type it does not handle", async () => {
    await sendEvent({ id: "evt_unhandled", object: "event", type: "customer.created", data: { object: { id: "cus_1" } } }).expect(200);
  });
});

describe("the admin's free order", () => {
  it("writes a paid order for nothing, schedules its cards and claims the design", async () => {
    const { createAdmin } = await import("./auth.js");
    await createAdmin("free@example.com", "a-sufficiently-long-test-password");
    const agent = request.agent(app);
    const bootstrap = await agent.get("/api/session").expect(200);
    const login = await agent
      .post("/api/session")
      .set("x-csrf-token", bootstrap.body.csrfToken as string)
      .send({ email: "free@example.com", password: "a-sufficiently-long-test-password" })
      .expect(200);
    const csrf = login.body.csrfToken as string;

    const designId = await design();
    const response = await agent
      .post("/api/admin/orders/complimentary")
      .set("x-csrf-token", csrf)
      .send({ lines: [{ designs: [{ designId, mailDate: addDaysIso(todayIso(), 2) }], recipients: [RECIPIENT, { ...RECIPIENT, name: "Grandpa" }] }] })
      .expect(201);

    const order = response.body.order as Order;
    expect(order.status).toBe("paid");
    expect(order.totalCents).toBe(0);
    expect(order.unitPriceCents).toBe(0);
    expect(order.postcardCount).toBe(2);
    expect(order.email).toBe("free@example.com");
    expect(order.postcards.every((p: { status: string }) => p.status === "scheduled")).toBe(true);
    // Never reached Stripe.
    expect(createSession).not.toHaveBeenCalled();

    const { getDesign } = await import("../db/designs-repository.js");
    expect((await getDesign(designId))?.orderId).toBe(order.id);

    // The same checks as checkout: the design is spoken for now.
    await agent
      .post("/api/admin/orders/complimentary")
      .set("x-csrf-token", csrf)
      .send({ lines: [{ designs: [{ designId, mailDate: todayIso() }], recipients: [RECIPIENT] }] })
      .expect(409);
  });
});

describe("the confirmation lookup", () => {
  it("returns the order's postcards, without Lob's error text", async () => {
    const designId = await design();
    const { sessionId, orderId } = await startCheckout([{ designs: [{ designId, mailDate: todayIso() }], recipients: [RECIPIENT] }]);
    await sendEvent(completedSessionEvent({ sessionId, orderId })).expect(200);

    const { markPostcardFailed, getOrder } = await import("../db/orders-repository.js");
    const order = await getOrder(orderId);
    await markPostcardFailed(order!.postcards[0]!.id, "Lob refused it (422): address_line1 is too long", "error");

    const response = await request(app).get(`/api/checkout/${sessionId}`).expect(200);
    expect(response.body.postcards[0].status).toBe("error");
    expect(response.body.postcards[0].lastError).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain("Lob refused");
  });

  it("404s an unknown session", async () => {
    await request(app).get("/api/checkout/cs_test_nope").expect(404);
  });
});
