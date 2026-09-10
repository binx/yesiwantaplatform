import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Stripe from "stripe";
import sharp from "sharp";
import { addDaysIso, todayIso } from "../shared/postcards.js";

/**
 * The fulfilment sweep, against a fake Lob.
 *
 * `fetch` is replaced with a recorder that answers whatever the test says,
 * so what is asserted is what Lob is *sent* — the address fields, the print
 * file, the idempotency key — and what the sweep does with each kind of
 * answer: a 200 marks the card sent, a 422 parks it with Lob's message, a
 * 500 puts it back for the next tick.
 */

interface Sent {
  url: string;
  headers: Headers;
  form: FormData;
}

const sent: Sent[] = [];
let answer: () => Response = () =>
  new Response(JSON.stringify({ id: "psc_test_1", url: "https://lob.test/proof.pdf", expected_delivery_date: "2026-09-20" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let app: Express;
let stripe: Stripe;
let createSession: ReturnType<typeof vi.fn>;

const WEBHOOK_SECRET = "whsec_postcards_fake_webhook_secret";
const RECIPIENT = { name: "Grandma", line1: "1 Test Street", line2: "Apt 2", city: "Marfa", state: "TX", postalCode: "79843" };

beforeAll(async () => {
  process.env.LOB_API_KEY = "test_abcdef123456";

  vi.stubGlobal("fetch", async (input: Request | string | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const request = input instanceof Request ? input : new Request(url, init);
    sent.push({ url, headers: request.headers, form: await request.formData() });
    return answer();
  });

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
});

beforeEach(() => {
  sent.length = 0;
  createSession = vi.fn().mockImplementation(() => ({
    id: `cs_test_${Math.random().toString(36).slice(2)}`,
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
  }));
  vi.spyOn(stripe.checkout.sessions, "create").mockImplementation(
    createSession as unknown as typeof stripe.checkout.sessions.create,
  );
});

async function paidOrder(mailDate: string, recipients = [RECIPIENT]) {
  const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#00ffff" } }).png().toBuffer();
  const uploaded = await request(app)
    .post("/api/designs")
    .field("orientation", "landscape")
    .field("back", JSON.stringify({ text: "Wish you were here <3", valediction: "Love, R" }))
    .attach("file", png, { filename: "a.png", contentType: "image/png" })
    .expect(201);
  const designId = uploaded.body.id as string;

  await request(app).post("/api/checkout").send({ lines: [{ designs: [{ designId, mailDate }], recipients }] }).expect(200);
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
        amount_subtotal: 140 * recipients.length,
        amount_total: 140 * recipients.length,
        total_details: { amount_discount: 0 },
        customer_details: { email: "buyer@example.com" },
        metadata: { postcards_order_id: orderId },
      },
    },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  await request(app).post("/api/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", header).send(payload).expect(200);

  // The webhook's own kick is off under test (`createApp` sets it with the
  // schedulers), so the sweep only ever runs when a test calls it.
  sent.length = 0;

  return { orderId, designId };
}

describe("sendDuePostcards", () => {
  it("sends a due card to Lob with the address, the print file and an idempotency key", async () => {
    const { orderId } = await paidOrder(todayIso());
    const { sendDuePostcards } = await import("./fulfilment.js");

    const result = await sendDuePostcards();
    expect(result.sent).toBeGreaterThanOrEqual(1);

    const call = sent.find((s) => s.url.endsWith("/v1/postcards"));
    expect(call).toBeDefined();
    expect(call!.headers.get("authorization")).toMatch(/^Basic /);
    expect(call!.form.get("to[name]")).toBe("Grandma");
    expect(call!.form.get("to[address_line1]")).toBe("1 Test Street");
    expect(call!.form.get("to[address_line2]")).toBe("Apt 2");
    expect(call!.form.get("to[address_state]")).toBe("TX");
    expect(call!.form.get("to[address_zip]")).toBe("79843");
    expect(call!.form.get("size")).toBe("4x6");
    expect(call!.form.get("use_type")).toBe("operational");

    const front = call!.form.get("front");
    expect(front).toBeInstanceOf(Blob);
    const meta = await sharp(Buffer.from(await (front as Blob).arrayBuffer())).metadata();
    expect(meta.width).toBe(1875);
    expect(meta.height).toBe(1275);
    expect(meta.density).toBe(300);

    // The back is inline HTML, escaped, with the message in it.
    const back = call!.form.get("back") as string;
    expect(back).toContain("Wish you were here &lt;3");
    expect(back).toContain("Love, R");

    const { getOrder } = await import("../db/orders-repository.js");
    const order = await getOrder(orderId);
    expect(order?.postcards[0]?.status).toBe("sent");
    expect(order?.postcards[0]?.lobId).toBe("psc_test_1");
    expect(order?.postcards[0]?.expectedDeliveryDate).toBe("2026-09-20");
    // Our postcard id is the idempotency key, so a retried request cannot mail two.
    expect(call!.headers.get("idempotency-key")).toBe(order?.postcards[0]?.id);
    // Every card went, so the order is done.
    expect(order?.status).toBe("completed");
  });

  it("leaves a card whose day has not come", async () => {
    const { orderId } = await paidOrder(addDaysIso(todayIso(), 5));
    const { sendDuePostcards } = await import("./fulfilment.js");
    await sendDuePostcards();

    const { getOrder } = await import("../db/orders-repository.js");
    expect((await getOrder(orderId))?.postcards[0]?.status).toBe("scheduled");
    expect(sent.some((s) => s.url.endsWith("/v1/postcards"))).toBe(false);
  });

  it("parks a card Lob refused, with Lob's own words", async () => {
    answer = () =>
      new Response(JSON.stringify({ error: { message: "to.address_line1 must be less than 64 characters", status_code: 422, code: "invalid" } }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    const { orderId } = await paidOrder(todayIso());
    const { sendDuePostcards } = await import("./fulfilment.js");

    const result = await sendDuePostcards();
    expect(result.parked).toBeGreaterThanOrEqual(1);

    const { getOrder } = await import("../db/orders-repository.js");
    const order = await getOrder(orderId);
    expect(order?.postcards[0]?.status).toBe("error");
    expect(order?.postcards[0]?.lastError).toContain("address_line1 must be less than 64");
    // Still owed: an errored card keeps the order open.
    expect(order?.status).toBe("paid");

    answer = () => new Response(JSON.stringify({ id: "psc_test_2" }), { status: 200, headers: { "content-type": "application/json" } });
  });

  it("puts a card back for the next sweep when Lob is down", async () => {
    answer = () => new Response("bad gateway", { status: 502 });
    const { orderId } = await paidOrder(todayIso());
    const { sendDuePostcards } = await import("./fulfilment.js");

    const result = await sendDuePostcards();
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const { getOrder } = await import("../db/orders-repository.js");
    const order = await getOrder(orderId);
    expect(order?.postcards[0]?.status).toBe("scheduled");
    expect(order?.postcards[0]?.attempts).toBeGreaterThanOrEqual(1);
    expect(order?.postcards[0]?.lastError).toContain("502");

    answer = () => new Response(JSON.stringify({ id: "psc_test_3" }), { status: 200, headers: { "content-type": "application/json" } });
  });

  it("stops the sweep on a rate limit and charges no card an attempt", async () => {
    // Earlier tests leave due cards behind; send them first so this one sees only its own.
    await (await import("./fulfilment.js")).sendDuePostcards();
    let calls = 0;
    answer = () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "Rate limit exceeded", status_code: 429 } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "1" },
      });
    };
    const { orderId } = await paidOrder(todayIso(), [RECIPIENT, { ...RECIPIENT, name: "Grandpa" }, { ...RECIPIENT, name: "Auntie" }]);
    const { sendDuePostcards } = await import("./fulfilment.js");

    const result = await sendDuePostcards(todayIso(), { retryWaitCapMs: 10 });
    expect(result.skipped).toMatch(/rate-limited/);
    expect(result.sent + result.failed + result.parked).toBe(0);
    // The first card, then one retry after Retry-After; nothing for the rest.
    expect(calls).toBe(2);

    const { getOrder } = await import("../db/orders-repository.js");
    const order = (await getOrder(orderId))!;
    expect(order.postcards.every((p) => p.status === "scheduled")).toBe(true);
    expect(order.postcards.every((p) => p.attempts === 0)).toBe(true);
    expect(order.postcards.filter((p) => p.lastError?.includes("429"))).toHaveLength(1);

    answer = () => new Response(JSON.stringify({ id: "psc_test_5" }), { status: 200, headers: { "content-type": "application/json" } });
  });

  it("stops the sweep when Lob cannot be reached at all", async () => {
    // Earlier tests leave due cards behind; send them first so this one sees only its own.
    await (await import("./fulfilment.js")).sendDuePostcards();
    answer = () => {
      throw new TypeError("fetch failed");
    };
    const { orderId } = await paidOrder(todayIso(), [RECIPIENT, { ...RECIPIENT, name: "Grandpa" }]);
    const { sendDuePostcards } = await import("./fulfilment.js");

    const result = await sendDuePostcards();
    expect(result.skipped).toMatch(/could not be reached/);

    const { getOrder } = await import("../db/orders-repository.js");
    const order = (await getOrder(orderId))!;
    expect(order.postcards.every((p) => p.status === "scheduled" && p.attempts === 0)).toBe(true);

    answer = () => new Response(JSON.stringify({ id: "psc_test_6" }), { status: 200, headers: { "content-type": "application/json" } });
  });

  it("carries on past a 5xx on one card, and that card alone pays an attempt", async () => {
    // Earlier tests leave due cards behind; send them first so this one sees only its own.
    await (await import("./fulfilment.js")).sendDuePostcards();
    let calls = 0;
    answer = () => {
      calls += 1;
      if (calls === 2) return new Response("bad gateway", { status: 502 });
      return new Response(JSON.stringify({ id: `psc_test_7_${calls}` }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const { orderId } = await paidOrder(todayIso(), [RECIPIENT, { ...RECIPIENT, name: "Grandpa" }, { ...RECIPIENT, name: "Auntie" }]);
    const { sendDuePostcards } = await import("./fulfilment.js");

    const result = await sendDuePostcards();
    expect(result.skipped).toBeNull();
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);

    const { getOrder } = await import("../db/orders-repository.js");
    const order = (await getOrder(orderId))!;
    const back = order.postcards.filter((p) => p.status === "scheduled");
    expect(back).toHaveLength(1);
    expect(back[0]?.attempts).toBe(1);
    expect(order.postcards.filter((p) => p.status === "sent")).toHaveLength(2);

    answer = () => new Response(JSON.stringify({ id: "psc_test_8" }), { status: 200, headers: { "content-type": "application/json" } });
  });

  it("honours Retry-After once and sends the card when the limit was a burst", async () => {
    // Earlier tests leave due cards behind; send them first so this one sees only its own.
    await (await import("./fulfilment.js")).sendDuePostcards();
    let calls = 0;
    answer = () => {
      calls += 1;
      if (calls === 1) return new Response("", { status: 429, headers: { "retry-after": "0" } });
      return new Response(JSON.stringify({ id: "psc_test_9" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const { orderId } = await paidOrder(todayIso());
    const { sendDuePostcards, getLastSweep } = await import("./fulfilment.js");

    const result = await sendDuePostcards(todayIso(), { retryWaitCapMs: 10 });
    expect(result.sent).toBe(1);
    expect(result.skipped).toBeNull();
    expect(calls).toBe(2);
    expect(getLastSweep()?.result.sent).toBe(1);

    const { getOrder } = await import("../db/orders-repository.js");
    expect((await getOrder(orderId))?.postcards[0]?.status).toBe("sent");
  });

  it("only ever claims a card once, even when two sweeps race", async () => {
    const { orderId } = await paidOrder(todayIso());
    const { getOrder, claimPostcard } = await import("../db/orders-repository.js");
    const card = (await getOrder(orderId))!.postcards[0]!;

    const [a, b] = await Promise.all([claimPostcard(card.id), claimPostcard(card.id)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("lets the admin retry a parked card and withdraw a scheduled one", async () => {
    answer = () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 422, headers: { "content-type": "application/json" } });
    const { orderId } = await paidOrder(todayIso(), [RECIPIENT, { ...RECIPIENT, name: "Grandpa" }]);
    const { sendDuePostcards } = await import("./fulfilment.js");
    await sendDuePostcards();
    answer = () => new Response(JSON.stringify({ id: "psc_test_4" }), { status: 200, headers: { "content-type": "application/json" } });

    const { createAdmin } = await import("./auth.js");
    await createAdmin(`retry-${orderId.slice(0, 8)}@example.com`, "a-sufficiently-long-test-password");
    const agent = request.agent(app);
    const bootstrap = await agent.get("/api/session").expect(200);
    const login = await agent
      .post("/api/session")
      .set("x-csrf-token", bootstrap.body.csrfToken as string)
      .send({ email: `retry-${orderId.slice(0, 8)}@example.com`, password: "a-sufficiently-long-test-password" })
      .expect(200);
    const csrf = login.body.csrfToken as string;

    const { getOrder } = await import("../db/orders-repository.js");
    let order = (await getOrder(orderId))!;
    expect(order.postcards.every((p) => p.status === "error")).toBe(true);
    const [first, second] = order.postcards as [typeof order.postcards[number], typeof order.postcards[number]];

    await agent.post(`/api/admin/orders/${orderId}/postcards/${first.id}/retry`).set("x-csrf-token", csrf).expect(200);
    await agent.post(`/api/admin/orders/${orderId}/postcards/${second.id}/cancel`).set("x-csrf-token", csrf).expect(200);

    order = (await getOrder(orderId))!;
    expect(order.postcards.find((p) => p.id === first.id)?.status).toBe("scheduled");
    expect(order.postcards.find((p) => p.id === second.id)?.status).toBe("cancelled");

    await sendDuePostcards();
    order = (await getOrder(orderId))!;
    expect(order.postcards.find((p) => p.id === first.id)?.status).toBe("sent");
    expect(order.status).toBe("completed");
  });
});

describe("cleanUp", () => {
  it("deletes a design nobody bought after a month, and trims a sent design's print file", async () => {
    const { getDatabase } = await import("../db/client.js");
    const { eq } = await import("drizzle-orm");
    const { drizzle: db, schema, dialect } = await getDatabase();

    // An orphan, backdated.
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#000000" } }).png().toBuffer();
    const orphan = (await request(app).post("/api/designs").field("orientation", "portrait").attach("file", png, { filename: "a.png", contentType: "image/png" }).expect(201)).body.id as string;
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await db
      .update(schema.postcardDesigns)
      .set({ createdAt: dialect === "pg" ? old : Math.floor(old.getTime() / 1000) })
      .where(eq(schema.postcardDesigns.id, orphan));

    // A sent design.
    const { designId } = await paidOrder(todayIso());
    const { sendDuePostcards, cleanUp } = await import("./fulfilment.js");
    await sendDuePostcards();

    const result = await cleanUp();
    expect(result.orphansDeleted).toBeGreaterThanOrEqual(1);
    expect(result.printFilesRemoved).toBeGreaterThanOrEqual(1);

    const { getDesign } = await import("../db/designs-repository.js");
    expect(await getDesign(orphan)).toBeNull();
    const kept = await getDesign(designId);
    expect(kept).not.toBeNull();
    expect(kept?.printPath).toBeNull();
    expect(kept?.thumbnailPath).toBeTruthy();
  });
});
