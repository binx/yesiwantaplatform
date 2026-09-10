import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Stripe from "stripe";
import sharp from "sharp";
import { todayIso } from "../shared/postcards.js";

/**
 * Lob's tracking webhook: signed the way Lob signs, deduplicated, and read
 * into a timeline that only ever moves forward.
 */
const SECRET = "lob-webhook-secret-for-tests";
const STRIPE_SECRET = "whsec_postcards_fake_webhook_secret";

let app: Express;
let stripe: Stripe;
let createSession: ReturnType<typeof vi.fn>;
const lobAnswer: () => Response = () =>
  new Response(JSON.stringify({ id: `psc_${Math.random().toString(36).slice(2)}`, expected_delivery_date: "2026-09-20" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeAll(async () => {
  process.env.LOB_API_KEY = "test_abcdef123456";
  process.env.LOB_WEBHOOK_SECRET = SECRET;
  vi.stubGlobal("fetch", () => Promise.resolve(lobAnswer()));

  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");
  const { requireStripe } = await import("./stripe.js");

  await runMigrations();
  await seedIfEmpty();
  app = createApp();
  stripe = requireStripe();
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.LOB_API_KEY;
  delete process.env.LOB_WEBHOOK_SECRET;
});

beforeEach(() => {
  createSession = vi.fn().mockImplementation(() => ({ id: `cs_test_${Math.random().toString(36).slice(2)}`, url: "https://checkout.stripe.com/c/pay/x" }));
  vi.spyOn(stripe.checkout.sessions, "create").mockImplementation(createSession as unknown as typeof stripe.checkout.sessions.create);
});

/** A paid order whose cards have gone to Lob, so each has a Lob id to be tracked by. */
async function sentCard(cards = 1) {
  const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#00ffff" } }).png().toBuffer();
  const uploaded = await request(app).post("/api/designs").field("orientation", "landscape").attach("file", png, { filename: "a.png", contentType: "image/png" }).expect(201);
  const designId = uploaded.body.id as string;
  const recipients = Array.from({ length: cards }, (_unused, index) => ({ name: `Grandma ${index + 1}`, line1: "1 Test Street", line2: null, city: "Marfa", state: "TX", postalCode: "79843" }));

  await request(app).post("/api/checkout").send({ lines: [{ designs: [{ designId, mailDate: todayIso() }], recipients }] }).expect(200);
  const session = createSession.mock.results.at(-1)?.value as { id: string };
  const params = createSession.mock.calls.at(-1)?.[0] as Stripe.Checkout.SessionCreateParams;
  const orderId = params.metadata?.postcards_order_id as string;

  const payload = JSON.stringify({
    id: `evt_paid_${orderId}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: session.id,
        object: "checkout.session",
        payment_intent: `pi_${orderId}`,
        currency: "usd",
        amount_subtotal: 140 * cards,
        amount_total: 140 * cards,
        total_details: { amount_discount: 0 },
        customer_details: { email: "buyer@example.com" },
        metadata: { postcards_order_id: orderId },
      },
    },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_SECRET });
  await request(app).post("/api/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", header).send(payload).expect(200);

  const { sendDuePostcards } = await import("./fulfilment.js");
  await sendDuePostcards();

  const { getOrder } = await import("../db/orders-repository.js");
  const order = (await getOrder(orderId))!;
  const postcard = order.postcards[0]!;
  expect(order.postcards.every((card) => card.status === "sent")).toBe(true);
  return { orderId, postcard, postcards: order.postcards, sessionId: session.id };
}

function lobEvent(o: { id?: string; type: string; postcardId?: string; lobId?: string; at: string; location?: string }) {
  return {
    id: o.id ?? `evt_lob_${Math.random().toString(36).slice(2)}`,
    event_type: { id: o.type, object: "event_type" },
    reference_id: o.lobId ?? "psc_unknown",
    date_created: o.at,
    body: {
      id: o.lobId ?? "psc_unknown",
      metadata: o.postcardId ? { postcard_id: o.postcardId } : {},
      tracking_events: o.location ? [{ name: o.type, location: o.location, time: o.at }] : [],
    },
  };
}

function signed(event: unknown, options: { timestamp?: string; secret?: string } = {}) {
  const body = JSON.stringify(event);
  const timestamp = options.timestamp ?? String(Date.now());
  const signature = createHmac("sha256", options.secret ?? SECRET).update(`${timestamp}.${body}`).digest("hex");
  return request(app)
    .post("/api/webhooks/lob")
    .set("content-type", "application/json")
    .set("lob-signature", signature)
    .set("lob-signature-timestamp", timestamp)
    .send(body);
}

describe("POST /api/webhooks/lob", () => {
  it("refuses a missing, wrong or stale signature and records nothing", async () => {
    const { postcard } = await sentCard();
    const event = lobEvent({ type: "postcard.in_transit", postcardId: postcard.id, at: new Date().toISOString() });

    await request(app).post("/api/webhooks/lob").set("content-type", "application/json").send(JSON.stringify(event)).expect(400);
    await signed(event, { secret: "not-the-secret" }).expect(400);
    await signed(event, { timestamp: String(Date.now() - 10 * 60 * 1000) }).expect(400);

    const { getPostcard } = await import("../db/orders-repository.js");
    const fresh = await getPostcard((await sentOrderIdOf(postcard.id)) ?? "", postcard.id);
    expect(fresh?.tracking).toEqual([]);
  });

  it("records a scan once, however many times Lob delivers it", async () => {
    const { orderId, postcard } = await sentCard();
    const event = lobEvent({ type: "postcard.in_transit", postcardId: postcard.id, at: "2026-09-15T10:00:00Z", location: "SAN FRANCISCO CA" });

    await signed(event).expect(200);
    const again = await signed(event).expect(200);
    expect(again.body.duplicate).toBe(true);

    const { getOrder } = await import("../db/orders-repository.js");
    const card = (await getOrder(orderId))!.postcards[0]!;
    expect(card.trackingStatus).toBe("postcard.in_transit");
    expect(card.tracking).toEqual([{ type: "postcard.in_transit", occurredAt: Date.parse("2026-09-15T10:00:00Z"), location: "SAN FRANCISCO CA" }]);
  });

  it("finds the card by Lob's own id when the metadata is missing, and shrugs at a card it never had", async () => {
    const { orderId, postcard } = await sentCard();
    await signed(lobEvent({ type: "postcard.in_local_area", lobId: postcard.lobId!, at: "2026-09-16T10:00:00Z" })).expect(200);

    const { getOrder } = await import("../db/orders-repository.js");
    expect((await getOrder(orderId))!.postcards[0]!.trackingStatus).toBe("postcard.in_local_area");

    const unknown = await signed(lobEvent({ type: "postcard.in_transit", lobId: "psc_never_seen", at: "2026-09-16T10:00:00Z" })).expect(200);
    expect(unknown.body.unknown).toBe(true);
  });

  it("keeps the status at the latest scan when events arrive out of order, and hides the quiet ones", async () => {
    const { orderId, postcard } = await sentCard();
    await signed(lobEvent({ type: "postcard.delivered", postcardId: postcard.id, at: "2026-09-18T15:00:00Z" })).expect(200);
    await signed(lobEvent({ type: "postcard.in_transit", postcardId: postcard.id, at: "2026-09-15T10:00:00Z" })).expect(200);
    await signed(lobEvent({ type: "postcard.rendered_pdf", postcardId: postcard.id, at: "2026-09-19T10:00:00Z" })).expect(200);

    const { getOrder } = await import("../db/orders-repository.js");
    const card = (await getOrder(orderId))!.postcards[0]!;
    expect(card.trackingStatus).toBe("postcard.delivered");
    expect(card.tracking.map((e) => e.type)).toEqual(["postcard.in_transit", "postcard.delivered"]);
  });

  it("writes a returned card into the admin's error column, in our words, and not the buyer's view", async () => {
    const { orderId, postcard, sessionId } = await sentCard();
    await signed(lobEvent({ type: "postcard.returned_to_sender", postcardId: postcard.id, at: "2026-09-20T10:00:00Z" })).expect(200);

    const { getOrder } = await import("../db/orders-repository.js");
    const card = (await getOrder(orderId))!.postcards[0]!;
    expect(card.status).toBe("sent");
    expect(card.lastError).toMatch(/Returned to sender/);

    const buyer = await request(app).get(`/api/checkout/${sessionId}`).expect(200);
    expect(buyer.body.postcards[0].lastError).toBeNull();
    expect(buyer.body.postcards[0].trackingStatus).toBe("postcard.returned_to_sender");
    expect(buyer.body.postcards[0].tracking).toHaveLength(1);
  });

  it("acknowledges an event about something that is not a postcard", async () => {
    const response = await signed(lobEvent({ type: "letter.created", lobId: "ltr_1", at: new Date().toISOString() })).expect(200);
    expect(response.body.ignored).toBe(true);
  });
});

/**
 * The admin's orders list, filtered to the cards that came back.
 *
 * Through the route rather than the repository, because the point of the
 * chip is that the query parameter it sends reaches `listOrders` — and that
 * the total agrees with the rows, which an order with two returned cards
 * would break if the filter were a join.
 */
describe("GET /api/admin/orders?returned=true", () => {
  it("lists only orders with a returned card, once each", async () => {
    const delivered = await sentCard();
    const returnedTwice = await sentCard(2);

    await signed(lobEvent({ type: "postcard.delivered", postcardId: delivered.postcard.id, at: "2026-09-18T15:00:00Z" })).expect(200);
    for (const card of returnedTwice.postcards) {
      await signed(lobEvent({ type: "postcard.returned_to_sender", postcardId: card.id, at: "2026-09-20T10:00:00Z" })).expect(200);
    }

    const agent = await adminAgent();
    const filtered = await agent.get("/api/admin/orders?returned=true").expect(200);
    const ids = (filtered.body.orders as { id: string }[]).map((order) => order.id);

    expect(ids).toContain(returnedTwice.orderId);
    expect(ids).not.toContain(delivered.orderId);
    expect(ids.filter((id) => id === returnedTwice.orderId)).toHaveLength(1);
    expect(filtered.body.total).toBe(ids.length);

    const all = await agent.get("/api/admin/orders").expect(200);
    const allIds = (all.body.orders as { id: string }[]).map((order) => order.id);
    expect(allIds).toContain(delivered.orderId);
    expect(allIds).toContain(returnedTwice.orderId);
  });

  it("filters the CSV the same way, so the download matches the screen", async () => {
    const delivered = await sentCard();
    const returned = await sentCard();
    await signed(lobEvent({ type: "postcard.delivered", postcardId: delivered.postcard.id, at: "2026-09-18T15:00:00Z" })).expect(200);
    await signed(lobEvent({ type: "postcard.returned_to_sender", postcardId: returned.postcard.id, at: "2026-09-20T10:00:00Z" })).expect(200);

    const csv = await (await adminAgent()).get("/api/admin/orders.csv?returned=true").expect(200);
    expect(csv.text).toContain(returned.orderId);
    expect(csv.text).not.toContain(delivered.orderId);
  });
});

/** A signed-in administrator. Every call makes its own, so the tests do not share a session. */
async function adminAgent() {
  const email = `orders-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "a-sufficiently-long-test-password";
  const { createAdmin } = await import("./auth.js");
  await createAdmin(email, password);

  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);
  await agent.post("/api/session").set("x-csrf-token", bootstrap.body.csrfToken as string).send({ email, password }).expect(200);
  return agent;
}

async function sentOrderIdOf(postcardId: string): Promise<string | null> {
  const { getDatabase } = await import("../db/client.js");
  const { eq } = await import("drizzle-orm");
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db.select({ orderId: schema.postcards.orderId }).from(schema.postcards).where(eq(schema.postcards.id, postcardId)).limit(1)) as { orderId: string }[];
  return rows[0]?.orderId ?? null;
}
