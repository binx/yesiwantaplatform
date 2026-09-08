import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";

/**
 * Refunds.
 *
 * The half that moves money is an admin route; the half that changes the order
 * is the `charge.refunded` webhook, and only the webhook. These tests hold that
 * line — a 200 from `refunds.create` must not, on its own, mark anything
 * refunded — and check the arithmetic that decides full versus partial.
 */

let app: Express;
let stripe: Stripe;
let createSession: ReturnType<typeof vi.fn>;
let createRefund: ReturnType<typeof vi.fn>;

const WEBHOOK_SECRET = "whsec_beluga_fake_webhook_secret";
const PASSWORD = "a-sufficiently-long-test-password";

function signedEvent(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, header };
}

function refundEvent(overrides: {
  id?: string;
  orderId: string;
  amount: number;
  amountRefunded: number;
}) {
  return {
    id: overrides.id ?? `evt_${Math.random().toString(36).slice(2)}`,
    object: "event",
    type: "charge.refunded",
    data: {
      object: {
        id: `ch_${Math.random().toString(36).slice(2)}`,
        object: "charge",
        amount: overrides.amount,
        amount_refunded: overrides.amountRefunded,
        metadata: { beluga_order_id: overrides.orderId },
      },
    },
  };
}

function sendEvent(event: Record<string, unknown>) {
  const { payload, header } = signedEvent(event);
  return request(app)
    .post("/api/webhooks/stripe")
    .set("content-type", "application/json")
    .set("stripe-signature", header)
    .send(payload);
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

async function signIn() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);

  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email: "refunds@example.com", password: PASSWORD })
    .expect(200);

  return { agent, csrf: login.body.csrfToken as string };
}

/** A paid order, taken all the way through checkout and the payment webhook. */
async function paidOrder(): Promise<{ orderId: string; totalCents: number }> {
  await request(app)
    .post("/api/checkout")
    .send({ lines: [{ productId: "demo-mug", variantId: "demo-mug-default", quantity: 1 }] })
    .expect(200);

  const call = createSession.mock.calls.at(-1)?.[0] as Stripe.Checkout.SessionCreateParams;
  const session = createSession.mock.results.at(-1)?.value as { id: string };
  const orderId = call.metadata?.beluga_order_id as string;

  await sendEvent({
    id: `evt_paid_${orderId}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: session.id,
        object: "checkout.session",
        payment_intent: `pi_${orderId}`,
        currency: "usd",
        amount_subtotal: 2200,
        amount_total: 2200,
        total_details: { amount_shipping: 0, amount_tax: 0 },
        customer_details: { email: "buyer@example.com", name: "A Buyer" },
        metadata: { beluga_order_id: orderId },
      },
    },
  }).expect(200);

  return { orderId, totalCents: 2200 };
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");
  const { requireStripe } = await import("./stripe.js");
  const { getDatabase } = await import("../db/client.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("refunds@example.com", PASSWORD);

  app = createApp();
  stripe = requireStripe();

  const { drizzle: db, schema } = await getDatabase();
  await db
    .update(schema.variants)
    .set({ stripePriceId: "price_test_mug" })
    .where(eq(schema.variants.id, "demo-mug-default"));
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

  createRefund = vi.fn().mockImplementation(() => ({ id: "re_test_1", object: "refund" }));
  vi.spyOn(stripe.refunds, "create").mockImplementation(
    createRefund as unknown as typeof stripe.refunds.create,
  );
});

describe("the refund route", () => {
  it("refuses an order with no payment to refund", async () => {
    const { agent, csrf } = await signIn();

    // Started but never paid, so there is no payment intent on the row.
    await request(app)
      .post("/api/checkout")
      .send({ lines: [{ productId: "demo-mug", variantId: "demo-mug-default", quantity: 1 }] })
      .expect(200);
    const call = createSession.mock.calls.at(-1)?.[0] as Stripe.Checkout.SessionCreateParams;
    const orderId = call.metadata?.beluga_order_id as string;

    const response = await agent
      .post(`/api/admin/orders/${orderId}/refund`)
      .set("x-csrf-token", csrf)
      .send({})
      .expect(409);

    expect(response.body.error).toMatch(/no payment to refund/i);
    expect(createRefund).not.toHaveBeenCalled();
  });

  it("refuses to refund more than the order is worth", async () => {
    const { agent, csrf } = await signIn();
    const { orderId } = await paidOrder();

    const response = await agent
      .post(`/api/admin/orders/${orderId}/refund`)
      .set("x-csrf-token", csrf)
      .send({ amountCents: 500_00 })
      .expect(409);

    expect(response.body.error).toMatch(/\$22\.00 still refundable/);
    expect(createRefund).not.toHaveBeenCalled();
  });

  it("refuses to refund more than what is left after a partial", async () => {
    const { agent, csrf } = await signIn();
    const { orderId } = await paidOrder();

    await sendEvent(refundEvent({ orderId, amount: 2200, amountRefunded: 1500 })).expect(200);

    const response = await agent
      .post(`/api/admin/orders/${orderId}/refund`)
      .set("x-csrf-token", csrf)
      .send({ amountCents: 1000 })
      .expect(409);

    expect(response.body.error).toMatch(/\$7\.00 still refundable/);
  });

  it("sends the refund to Stripe without changing the order itself", async () => {
    const { agent, csrf } = await signIn();
    const { orderId } = await paidOrder();

    await agent
      .post(`/api/admin/orders/${orderId}/refund`)
      .set("x-csrf-token", csrf)
      .send({ amountCents: 1000, reason: "duplicate" })
      .expect(200);

    const [params, options] = createRefund.mock.calls[0] as [
      Stripe.RefundCreateParams,
      { idempotencyKey: string },
    ];
    expect(params.payment_intent).toBe(`pi_${orderId}`);
    expect(params.amount).toBe(1000);
    expect(params.reason).toBe("duplicate");
    expect(params.metadata).toEqual({ beluga_order_id: orderId });
    expect(options.idempotencyKey).toBe(`refund-${orderId}-1000`);

    // The webhook has not landed, so nothing about the order has moved. A 200
    // from Stripe's API is not a settled refund.
    const { getOrder } = await import("../db/orders-repository.js");
    const order = await getOrder(orderId);
    expect(order?.refundedCents).toBe(0);
    expect(order?.status).toBe("paid");
  });

  it("refunds the whole remainder when no amount is given", async () => {
    const { agent, csrf } = await signIn();
    const { orderId, totalCents } = await paidOrder();

    await agent
      .post(`/api/admin/orders/${orderId}/refund`)
      .set("x-csrf-token", csrf)
      .send({})
      .expect(200);

    const [params, options] = createRefund.mock.calls[0] as [
      Stripe.RefundCreateParams,
      { idempotencyKey: string },
    ];
    expect(params.amount).toBe(totalCents);
    expect(options.idempotencyKey).toBe(`refund-${orderId}-full`);
  });
});

describe("the charge.refunded webhook", () => {
  it("leaves fulfilment alone for a partial refund", async () => {
    const { orderId } = await paidOrder();

    await sendEvent(refundEvent({ orderId, amount: 2200, amountRefunded: 700 })).expect(200);

    const { getOrder } = await import("../db/orders-repository.js");
    const order = await getOrder(orderId);

    expect(order?.refundedCents).toBe(700);
    // Still shipping: one damaged item out of several does not stop the rest.
    expect(order?.status).toBe("paid");
  });

  it("accumulates partial refunds and flips the status on the last one", async () => {
    const { orderId } = await paidOrder();

    await sendEvent(refundEvent({ orderId, amount: 2200, amountRefunded: 700 })).expect(200);
    // amount_refunded is the running total on the charge, not this event's delta.
    await sendEvent(refundEvent({ orderId, amount: 2200, amountRefunded: 2200 })).expect(200);

    const { getOrder } = await import("../db/orders-repository.js");
    const order = await getOrder(orderId);

    expect(order?.refundedCents).toBe(2200);
    expect(order?.status).toBe("refunded");
  });

  it("does not double the refunded total when Stripe replays an event", async () => {
    const { orderId } = await paidOrder();
    const event = refundEvent({ id: `evt_refund_replay_${orderId}`, orderId, amount: 2200, amountRefunded: 900 });

    await sendEvent(event).expect(200);
    const second = await sendEvent(event).expect(200);

    expect(second.body.duplicate).toBe(true);

    const { getOrder } = await import("../db/orders-repository.js");
    expect((await getOrder(orderId))?.refundedCents).toBe(900);
  });
});

describe("recordRefund", () => {
  it("is additive across calls", async () => {
    const { orderId } = await paidOrder();
    const { getOrder, recordRefund } = await import("../db/orders-repository.js");

    await recordRefund(orderId, 300);
    await recordRefund(orderId, 450);

    expect((await getOrder(orderId))?.refundedCents).toBe(750);
  });
});

describe("restocking", () => {
  it("returns the stock a fully refunded order took", async () => {
    await setStock("demo-mug-default", 10);
    const { orderId } = await paidOrder();
    expect(await stockOf("demo-mug-default")).toBe(9);

    await sendEvent(refundEvent({ orderId, amount: 2200, amountRefunded: 2200 })).expect(200);

    expect(await stockOf("demo-mug-default")).toBe(10);
  });

  it("does not restock a partial refund", async () => {
    await setStock("demo-mug-default", 10);
    const { orderId } = await paidOrder();

    await sendEvent(refundEvent({ orderId, amount: 2200, amountRefunded: 500 })).expect(200);

    // A partial refund says nothing about which line came back.
    expect(await stockOf("demo-mug-default")).toBe(9);
  });

  it("does not restock twice when Stripe replays the refund", async () => {
    await setStock("demo-mug-default", 10);
    const { orderId } = await paidOrder();

    // Two distinct events for the same charge, so webhook dedup does not cover
    // this — the restockedAt guard has to.
    await sendEvent(refundEvent({ orderId, amount: 2200, amountRefunded: 2200 })).expect(200);
    await sendEvent(refundEvent({ orderId, amount: 2200, amountRefunded: 2200 })).expect(200);

    expect(await stockOf("demo-mug-default")).toBe(10);
  });

  it("restocks when an order is cancelled, but not on every later save", async () => {
    await setStock("demo-mug-default", 10);
    const { orderId } = await paidOrder();
    const { agent, csrf } = await signIn();

    await agent
      .put(`/api/admin/orders/${orderId}`)
      .set("x-csrf-token", csrf)
      .send({ status: "cancelled", carrier: null, trackingNumber: null, notify: false })
      .expect(200);

    expect(await stockOf("demo-mug-default")).toBe(10);

    // A merchant correcting a tracking-number typo must not restock again.
    await agent
      .put(`/api/admin/orders/${orderId}`)
      .set("x-csrf-token", csrf)
      .send({ status: "cancelled", carrier: "Royal Mail", trackingNumber: "X1", notify: false })
      .expect(200);

    expect(await stockOf("demo-mug-default")).toBe(10);
  });
});
