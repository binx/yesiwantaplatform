import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Stripe from "stripe";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { todayIso } from "../shared/postcards.js";

/**
 * The reply link, end to end.
 *
 * A code goes onto the back as a QR; the page behind it is dark until the
 * card lands; the recipient can say it arrived and send one back; and the
 * sender's address is never in anything the recipient can read.
 */
const SECRET = "lob-webhook-secret-for-tests";
const STRIPE_SECRET = "whsec_postcards_fake_webhook_secret";
const PASSWORD = "a-sufficiently-long-test-password";
const SENDER_ADDRESS = { name: "ignored", line1: "742 Evergreen Terrace", line2: null, city: "Springfield", state: "OR", postalCode: "97477", country: "US" };
const GRANDMA = { name: "Grandma", line1: "1 Test Street", line2: null, city: "Marfa", state: "TX", postalCode: "79843", country: "US" };

const mail: { to?: string; subject?: string; html?: string }[] = [];
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: (message: { to?: string; subject?: string; html?: string }) => {
        mail.push(message);
        return Promise.resolve({ messageId: "test" });
      },
    }),
  },
}));

let app: Express;
let stripe: Stripe;
let createSession: ReturnType<typeof vi.fn>;
/** Everything the sweep sent to Lob, as it went over the wire. */
const lobRequests: { url: string; body: string }[] = [];

beforeAll(async () => {
  process.env.LOB_API_KEY = "test_abcdef123456";
  process.env.LOB_WEBHOOK_SECRET = SECRET;
  process.env.SMTP_URL = "smtps://user:pass@smtp.example.com:465";
  process.env.EMAIL_FROM = "store@example.com";
  vi.stubGlobal("fetch", (url: string | URL, init?: RequestInit) => {
    const body = init?.body instanceof FormData ? [...init.body.entries()].map(([k, v]) => `${k}=${typeof v === "string" ? v : "<file>"}`).join("\n") : typeof init?.body === "string" ? init.body : "";
    lobRequests.push({ url: String(url), body });
    return Promise.resolve(
      new Response(JSON.stringify({ id: `psc_${Math.random().toString(36).slice(2)}`, expected_delivery_date: "2026-09-20" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");
  const { requireStripe } = await import("./stripe.js");
  const { createCustomer } = await import("./auth.js");

  await runMigrations();
  await seedIfEmpty();
  await createCustomer("sender@example.com", PASSWORD, "Rachel");
  await createCustomer("replier@example.com", PASSWORD, "Gran");
  app = createApp();
  stripe = requireStripe();
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.LOB_API_KEY;
  delete process.env.LOB_WEBHOOK_SECRET;
  delete process.env.SMTP_URL;
  delete process.env.EMAIL_FROM;
});

beforeEach(() => {
  createSession = vi.fn().mockImplementation(() => ({ id: `cs_test_${Math.random().toString(36).slice(2)}`, url: "https://checkout.stripe.com/c/pay/x" }));
  vi.spyOn(stripe.checkout.sessions, "create").mockImplementation(createSession as unknown as typeof stripe.checkout.sessions.create);
});

async function signIn(email: string) {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);
  const login = await agent.post("/api/account/session").set("x-csrf-token", bootstrap.body.csrfToken as string).send({ email, password: PASSWORD }).expect(200);
  return { agent, csrf: login.body.csrfToken as string };
}

async function design(agent: request.Agent | request.SuperTest<request.Test> = request(app)): Promise<string> {
  const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#00ffff" } }).png().toBuffer();
  const response = await agent
    .post("/api/designs")
    .field("orientation", "landscape")
    .field("back", JSON.stringify({ text: "Wish you were here" }))
    .attach("file", png, { filename: "a.png", contentType: "image/png" })
    .expect(201);
  return response.body.id as string;
}

/** Pay for whatever the checkout just made, the way Stripe would tell us. */
async function pay(sessionId: string, orderId: string) {
  const payload = JSON.stringify({
    id: `evt_paid_${orderId}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_intent: `pi_${orderId}`,
        currency: "usd",
        amount_subtotal: 140,
        amount_total: 140,
        total_details: { amount_discount: 0 },
        customer_details: { email: "buyer@example.com" },
        metadata: { postcards_order_id: orderId },
      },
    },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_SECRET });
  await request(app).post("/api/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", header).send(payload).expect(200);
}

async function checkout(agent: request.Agent, lines: unknown) {
  const response = await agent.post("/api/checkout").send({ lines });
  if (response.status !== 200) return { status: response.status, error: response.body.error as string, orderId: "", sessionId: "" };
  const session = createSession.mock.results.at(-1)?.value as { id: string };
  const params = createSession.mock.calls.at(-1)?.[0] as Stripe.Checkout.SessionCreateParams;
  return { status: 200, error: "", orderId: params.metadata?.postcards_order_id as string, sessionId: session.id };
}

/** The sender, with replies allowed, mails one card to Grandma; it goes to Lob. */
async function sentCard(options: { replyLink?: boolean } = {}) {
  const sender = await signIn("sender@example.com");
  await sender.agent.put("/api/account/reply-address").set("x-csrf-token", sender.csrf).send({ displayName: "Rachel", address: SENDER_ADDRESS }).expect(204);

  const designId = await design(sender.agent);
  const { orderId, sessionId } = await checkout(sender.agent, [{ designs: [{ designId, mailDate: todayIso() }], recipients: [GRANDMA], replyLink: options.replyLink ?? true }]);
  await pay(sessionId, orderId);

  const { sendDuePostcards } = await import("./fulfilment.js");
  await sendDuePostcards();

  const { getOrder } = await import("../db/orders-repository.js");
  const order = (await getOrder(orderId))!;
  const postcard = order.postcards[0]!;
  expect(postcard.status).toBe("sent");
  return { sender, orderId, postcard, code: postcard.replyCode };
}

async function delivered(postcardId: string) {
  const { recordTrackingEvent } = await import("../db/orders-repository.js");
  await recordTrackingEvent(postcardId, { id: `evt_${postcardId}_delivered`, type: "postcard.delivered", occurredAt: Date.now(), location: null });
}

describe("the code on the back", () => {
  it("prints a QR to the card's page, and nothing when the buyer turned it off", async () => {
    lobRequests.length = 0;
    const { code } = await sentCard();
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);

    // The URL is only ever in the QR itself: the printed back names no address.
    const sent = lobRequests.find((r) => r.url.includes("/postcards"))!;
    expect(sent.body).toContain("<svg");
    expect(sent.body).not.toContain(`/r/${code}`);
    expect(sent.body).toContain("Scan to see this card online");

    lobRequests.length = 0;
    const plain = await sentCard({ replyLink: false });
    expect(plain.code).toBeNull();
    const plainSent = lobRequests.find((r) => r.url.includes("/postcards"))!;
    expect(plainSent.body).not.toContain("<svg");
    expect(plainSent.body).not.toContain("Scan to see");
  });

  it("is dark until the card lands, then shows the card and the sender's first name — never their address", async () => {
    const { postcard, code } = await sentCard();
    await request(app).get(`/api/r/${code}`).expect(404);
    await request(app).get("/api/r/NOTACODE1").expect(404);
    await request(app).get("/api/r/not-a-code-at-all").expect(404);

    await delivered(postcard.id);
    const page = await request(app).get(`/api/r/${code}`).expect(200);
    expect(page.body).toMatchObject({ senderName: "Rachel", canReply: true, mailedOn: todayIso(), orientation: "landscape" });
    expect(page.body.back.text).toBe("Wish you were here");
    expect(page.body.front.path).toBeTruthy();
    expect(JSON.stringify(page.body)).not.toContain(SENDER_ADDRESS.line1);
    expect(JSON.stringify(page.body)).not.toContain(GRANDMA.line1);
    expect(JSON.stringify(page.body)).not.toContain("sender@example.com");
  });

  it("also opens a week after mailing when no tracking ever arrives", async () => {
    const { postcard, code } = await sentCard();
    const { getDatabase } = await import("../db/client.js");
    const { drizzle: db, schema, dialect } = await getDatabase();
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await db
      .update(schema.postcards)
      .set({ sentAt: (dialect === "sqlite" ? Math.floor(eightDaysAgo / 1000) : new Date(eightDaysAgo)) as never })
      .where(eq(schema.postcards.id, postcard.id));
    await request(app).get(`/api/r/${code}`).expect(200);
  });

  it("shows the sender their card's code on the order, and nothing about who has looked at it", async () => {
    const { sender, orderId, postcard, code } = await sentCard();
    await delivered(postcard.id);
    await request(app).get(`/api/r/${code}`).expect(200);
    await request(app).get(`/api/r/${code}`).expect(200);

    const theirs = await sender.agent.get(`/api/account/orders/${orderId}`).expect(200);
    expect(theirs.body.postcards[0].replyCode).toBe(code);
    expect(JSON.stringify(theirs.body)).not.toMatch(/viewed|seen/i);
  });

  it("goes dark for good when the sender turns it off", async () => {
    const { sender, orderId, postcard, code } = await sentCard();
    await delivered(postcard.id);
    await request(app).get(`/api/r/${code}`).expect(200);

    await sender.agent.post(`/api/account/orders/${orderId}/postcards/${postcard.id}/reply/disable`).set("x-csrf-token", sender.csrf).expect(204);
    await request(app).get(`/api/r/${code}`).expect(404);
    const theirs = await sender.agent.get(`/api/account/orders/${orderId}`).expect(200);
    expect(theirs.body.postcards[0].replyCode).toBeNull();

    // Somebody else's order is not theirs to switch off.
    const other = await signIn("replier@example.com");
    await other.agent.post(`/api/account/orders/${orderId}/postcards/${postcard.id}/reply/disable`).set("x-csrf-token", other.csrf).expect(404);
  });
});

describe("sending one back", () => {
  it("addresses the reply to the sender at checkout, and keeps that address out of the replier's order and email", async () => {
    const { sender, orderId, postcard, code } = await sentCard();
    await delivered(postcard.id);
    const replier = await signIn("replier@example.com");
    const designId = await design(replier.agent);

    // The cart names the card, never an address; both at once is malformed.
    const mixed = await checkout(replier.agent, [{ designs: [{ designId, mailDate: todayIso() }], recipients: [GRANDMA], replyTo: code }]);
    expect(mixed.status).toBe(400);

    mail.length = 0;
    const reply = await checkout(replier.agent, [{ designs: [{ designId, mailDate: todayIso() }], recipients: [], replyTo: code, replyToName: "Rachel" }]);
    expect(reply.status).toBe(200);
    await pay(reply.sessionId, reply.orderId);

    const { getOrder } = await import("../db/orders-repository.js");
    const stored = (await getOrder(reply.orderId))!;
    expect(stored.replyToPostcardId).toBe(postcard.id);
    expect(stored.postcards[0]!.recipient).toMatchObject({ ...SENDER_ADDRESS, name: "Rachel" });
    expect(stored.postcards[0]!.isReply).toBe(true);

    const mine = await replier.agent.get(`/api/account/orders/${reply.orderId}`).expect(200);
    expect(mine.body.postcards[0]).toMatchObject({ isReply: true, recipient: { name: "Rachel", line1: "" } });
    expect(JSON.stringify(mine.body)).not.toContain(SENDER_ADDRESS.line1);
    expect(JSON.stringify(mine.body)).not.toContain(SENDER_ADDRESS.postalCode);

    const confirmation = mail.find((m) => m.to === "replier@example.com" || m.to === "buyer@example.com");
    expect(confirmation?.html).toContain("address kept private");
    expect(confirmation?.html).not.toContain(SENDER_ADDRESS.line1);

    // The sender sees a reply on its way, and where it came from stays private too.
    const theirs = await sender.agent.get(`/api/account/orders/${orderId}`).expect(200);
    expect(theirs.body.postcards[0].replies).toEqual({ onTheWay: 1, delivered: 0, thumbnail: null });
  });

  it("refuses a reply once the link is off, when the sender never allowed replies, and after three", async () => {
    const { sender, orderId, postcard, code } = await sentCard();
    await delivered(postcard.id);
    const replier = await signIn("replier@example.com");
    const line = async () => [{ designs: [{ designId: await design(replier.agent), mailDate: todayIso() }], recipients: [], replyTo: code }];

    for (let i = 0; i < 3; i += 1) {
      const paid = await checkout(replier.agent, await line());
      expect(paid.status).toBe(200);
      await pay(paid.sessionId, paid.orderId);
    }
    const fourth = await checkout(replier.agent, await line());
    expect(fourth.status).toBe(409);
    expect(fourth.error).toMatch(/as many replies/);

    // A fresh card, but the sender has since withdrawn their address.
    const second = await sentCard();
    await delivered(second.postcard.id);
    await sender.agent.delete("/api/account/reply-address").set("x-csrf-token", sender.csrf).expect(204);
    const page = await request(app).get(`/api/r/${second.code}`).expect(200);
    expect(page.body).toMatchObject({ canReply: false, senderName: null });
    const closed = await checkout(replier.agent, [{ designs: [{ designId: await design(replier.agent), mailDate: todayIso() }], recipients: [], replyTo: second.code }]);
    expect(closed.status).toBe(409);
    expect(closed.error).toMatch(/can't be replied to/);

    // And a code the sender switched off.
    await sender.agent.put("/api/account/reply-address").set("x-csrf-token", sender.csrf).send({ displayName: "Rachel", address: SENDER_ADDRESS }).expect(204);
    await sender.agent.post(`/api/account/orders/${orderId}/postcards/${postcard.id}/reply/disable`).set("x-csrf-token", sender.csrf).expect(204);
    const off = await checkout(replier.agent, await line());
    expect(off.status).toBe(409);
  });

  it("keeps the reply address on the account behind the sign-in, and validates it", async () => {
    const sender = await signIn("sender@example.com");
    await sender.agent.put("/api/account/reply-address").set("x-csrf-token", sender.csrf).send({ displayName: "", address: SENDER_ADDRESS }).expect(400);
    await sender.agent.put("/api/account/reply-address").set("x-csrf-token", sender.csrf).send({ displayName: "Rachel", address: { ...SENDER_ADDRESS, postalCode: "" } }).expect(400);
    await sender.agent.put("/api/account/reply-address").set("x-csrf-token", sender.csrf).send({ displayName: "Rachel", address: SENDER_ADDRESS }).expect(204);

    const profile = await sender.agent.get("/api/account").expect(200);
    expect(profile.body.customer.replyDisplayName).toBe("Rachel");
    expect(profile.body.customer.replyAddress).toMatchObject({ line1: SENDER_ADDRESS.line1 });
  });
});
