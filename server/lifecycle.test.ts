import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Stripe from "stripe";
import sharp from "sharp";
import { todayIso } from "../shared/postcards.js";

/**
 * The whole life of a postcard, end to end, against a fake Lob and a stubbed
 * Stripe.
 *
 * An artist makes a page, queues a card and goes live; a subscriber pays
 * (Checkout is stubbed, the signed webhook is real); the mailing sweep
 * writes the card; the print sweep sends it and the ledger records the
 * artist's share; the payout sweep transfers it once the artist can be
 * paid. What is asserted is what each outside party is *sent* and what each
 * kind of answer does to the rows.
 */

interface Sent {
  url: string;
  headers: Headers;
  form: FormData | null;
  json: unknown;
}

const sent: Sent[] = [];
let lobAnswer: (url: string) => Response = () =>
  new Response(JSON.stringify({ id: "psc_test_1", url: "https://lob.test/proof.pdf", expected_delivery_date: "2026-09-20" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let app: Express;
let stripe: Stripe;
const WEBHOOK_SECRET = "whsec_postcards_fake_webhook_secret";
const PASSWORD = "a-sufficiently-long-test-password";
const ADDRESS = { name: "Grandma", line1: "1 Test Street", line2: "Apt 2", city: "Marfa", state: "TX", postalCode: "79843", country: "US" };

beforeAll(async () => {
  process.env.LOB_API_KEY = "test_abcdef123456";

  vi.stubGlobal("fetch", async (input: Request | string | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const req = input instanceof Request ? input : new Request(url, init);
    const type = req.headers.get("content-type") ?? "";
    sent.push({
      url,
      headers: req.headers,
      form: type.startsWith("multipart/") ? await req.formData() : null,
      json: type.includes("json") ? await req.json() : null,
    });
    if (url.includes("verifications")) {
      return new Response(JSON.stringify({ deliverability: "deliverable", primary_line: "1 TEST ST", components: { city: "MARFA", state: "TX", zip_code: "79843" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return lobAnswer(url);
  });

  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin, createCustomer } = await import("./auth.js");
  const { createApp } = await import("./app.js");
  const { requireStripe } = await import("./stripe.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("admin@example.com", PASSWORD);
  await createCustomer("artist@example.com", PASSWORD, "Rachel");
  await createCustomer("fan@example.com", PASSWORD, "Grandma");
  app = createApp();
  stripe = requireStripe();
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.LOB_API_KEY;
});

beforeEach(() => {
  sent.length = 0;
  vi.spyOn(stripe.customers, "create").mockImplementation((() => Promise.resolve({ id: "cus_fan" })) as never);
  vi.spyOn(stripe.checkout.sessions, "create").mockImplementation((() =>
    Promise.resolve({ id: `cs_test_${Math.random().toString(36).slice(2)}`, url: "https://checkout.stripe.com/c/pay/cs_test_123" })) as never);
  vi.spyOn(stripe.subscriptions, "retrieve").mockImplementation((() =>
    Promise.resolve({ id: "sub_1", status: "active", items: { data: [{ current_period_end: 1_800_000_000 }] } })) as never);
  vi.spyOn(stripe.subscriptions, "update").mockImplementation((() => Promise.resolve({ id: "sub_1" })) as never);
});

async function signIn(email: string) {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);
  const login = await agent.post("/api/account/session").set("x-csrf-token", bootstrap.body.csrfToken as string).send({ email, password: PASSWORD }).expect(200);
  return { agent, csrf: login.body.csrfToken as string };
}

async function signInAdmin() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);
  const login = await agent.post("/api/session").set("x-csrf-token", bootstrap.body.csrfToken as string).send({ email: "admin@example.com", password: PASSWORD }).expect(200);
  return { agent, csrf: login.body.csrfToken as string };
}

function webhook(event: object) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return request(app).post("/api/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", header).send(payload);
}

let artistId = "";
let designId = "";
let mailingId = "";
let subscriptionId = "";
let checkoutSessionId = "";
let postcardId = "";

describe("an artist opens a page", () => {
  it("creates the page, uploads a card, queues it for today and goes live", async () => {
    const { agent, csrf } = await signIn("artist@example.com");

    const created = await agent.post("/api/studio").set("x-csrf-token", csrf).send({ slug: "rachel", name: "Rachel", tagline: "photos from the road", bio: "**Hi.**", monthlyPriceCents: 500, sendDay: 15 }).expect(201);
    artistId = created.body.artist.id;
    expect(created.body.artist.status).toBe("draft");
    expect(created.body.shareCents).toBe(320);
    // Unsaid, a subscription runs six months; unsaid, there is nowhere else to find them.
    expect(created.body.artist).toMatchObject({ termMonths: 6, links: [], banner: null });

    // Where else to find them, and a picture across the top. A link without a proper address is refused.
    const badLink = await agent
      .put("/api/studio/profile")
      .set("x-csrf-token", csrf)
      .send({ slug: "rachel", name: "Rachel", monthlyPriceCents: 500, links: [{ label: "Instagram", url: "instagram.com/rachel" }] });
    expect(badLink.status).toBe(400);
    const bannerPng = await sharp({ create: { width: 900, height: 300, channels: 3, background: "#ffcc00" } }).png().toBuffer();
    const banner = await agent.post("/api/studio/banner").set("x-csrf-token", csrf).attach("file", bannerPng, { filename: "banner.png", contentType: "image/png" }).expect(201);
    const profile = await agent
      .put("/api/studio/profile")
      .set("x-csrf-token", csrf)
      .send({
        slug: "rachel",
        name: "Rachel",
        tagline: "photos from the road",
        bio: "**Hi.**",
        monthlyPriceCents: 500,
        sendDay: 15,
        banner: banner.body,
        links: [
          { label: "", url: "https://www.rachel.example/" },
          { label: "Instagram", url: "https://instagram.com/rachel" },
        ],
      })
      .expect(200);
    expect(profile.body.artist.banner).toMatchObject({ path: banner.body.path, width: 900, height: 300 });
    expect(profile.body.artist.links).toEqual([
      { label: "", url: "https://www.rachel.example/" },
      { label: "Instagram", url: "https://instagram.com/rachel" },
    ]);

    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#00ffff" } }).png().toBuffer();
    const uploaded = await agent
      .post("/api/studio/designs")
      .set("x-csrf-token", csrf)
      .field("orientation", "landscape")
      .field("back", JSON.stringify({ text: "Wish you were here <3", valediction: "Love, R" }))
      .attach("file", png, { filename: "a.png", contentType: "image/png" })
      .expect(201);
    designId = uploaded.body.id;

    // The suggestion is the send day in the first free month.
    const queue = await agent.get("/api/studio/mailings").expect(200);
    expect(queue.body.nextMailDate).toMatch(/-15$/);

    const queued = await agent.post("/api/studio/mailings").set("x-csrf-token", csrf).send({ designId, mailDate: todayIso(), title: "The road" }).expect(201);
    mailingId = queued.body.id;
    expect(queued.body.status).toBe("queued");

    // One a month: the same month again is refused.
    const twice = await agent.post("/api/studio/mailings").set("x-csrf-token", csrf).send({ designId, mailDate: todayIso() });
    expect(twice.status).toBe(409);
    expect(twice.body.error).toMatch(/already scheduled/);

    const live = await agent.post("/api/studio/status").set("x-csrf-token", csrf).send({ status: "live" }).expect(200);
    expect(live.body.artist.status).toBe("live");

    // Now public.
    const page = await request(app).get("/api/artists/rachel").expect(200);
    expect(page.body.artist.bioHtml).toContain("<strong>Hi.</strong>");
    expect(page.body.artist.subscriberCount).toBe(0);
    const listed = (await request(app).get("/api/artists").expect(200)).body as { slug: string }[];
    expect(listed.map((a) => a.slug)).toEqual(["rachel"]);
  });
});

describe("a fan subscribes", () => {
  it("starts a Checkout with the artist's price, never the client's", async () => {
    const { agent, csrf } = await signIn("fan@example.com");

    const response = await agent.post("/api/checkout/subscribe").set("x-csrf-token", csrf).send({ artistId, address: ADDRESS, priceCents: 1 }).expect(200);
    subscriptionId = response.body.subscriptionId;
    expect(response.body.url).toContain("checkout.stripe.com");

    const params = (stripe.checkout.sessions.create as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as Stripe.Checkout.SessionCreateParams;
    expect(params.mode).toBe("subscription");
    expect(params.customer).toBe("cus_fan");
    expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(500);
    expect(params.line_items?.[0]?.price_data?.recurring?.interval).toBe("month");
    expect(params.metadata?.yiwap_subscription_id).toBe(subscriptionId);
    const { findSubscriptionByCheckoutSession, getSubscription } = await import("../db/subscriptions-repository.js");
    const row = (await getSubscription(subscriptionId))!;
    checkoutSessionId = row.stripeCheckoutSessionId;
    expect(row.status).toBe("incomplete");
    expect(await findSubscriptionByCheckoutSession(checkoutSessionId)).toMatchObject({ id: subscriptionId });

    // The address went through USPS and onto the account.
    expect(sent.some((s) => s.url.endsWith("/us_verifications"))).toBe(true);
    const me = await agent.get("/api/account").expect(200);
    expect(me.body.customer.address).toMatchObject({ line1: "1 Test Street" });

    // The confirmation page sees it as still confirming.
    const pending = await agent.get(`/api/checkout/${checkoutSessionId}`).expect(200);
    expect(pending.body.status).toBe("incomplete");
    // And nobody else sees it at all.
    const other = await signIn("artist@example.com");
    await other.agent.get(`/api/checkout/${checkoutSessionId}`).expect(404);
  });

  it("refuses a second subscription to the same artist, and the artist's own", async () => {
    const fan = await signIn("fan@example.com");
    // Not yet active: the incomplete one does not block a retry.
    await fan.agent.post("/api/checkout/subscribe").set("x-csrf-token", fan.csrf).send({ artistId, address: ADDRESS }).expect(200);
    const self = await signIn("artist@example.com");
    const response = await self.agent.post("/api/checkout/subscribe").set("x-csrf-token", self.csrf).send({ artistId, address: ADDRESS });
    expect(response.status).toBe(409);
  });

  it("becomes active only when the signed webhook says so, and records the first invoice", async () => {
    await webhook({
      id: `evt_completed_${subscriptionId}`,
      object: "event",
      type: "checkout.session.completed",
      data: { object: { id: checkoutSessionId, object: "checkout.session", mode: "subscription", subscription: "sub_1", metadata: { yiwap_subscription_id: subscriptionId } } },
    }).expect(200);

    const { getSubscription } = await import("../db/subscriptions-repository.js");
    expect(await getSubscription(subscriptionId)).toMatchObject({ status: "active", stripeSubscriptionId: "sub_1", currentPeriodEnd: 1_800_000_000_000 });

    // A replay is a no-op.
    const replay = await webhook({ id: `evt_completed_${subscriptionId}`, object: "event", type: "checkout.session.completed", data: { object: { id: checkoutSessionId, mode: "subscription", subscription: "sub_1" } } }).expect(200);
    expect(replay.body.duplicate).toBe(true);

    await webhook({
      id: `evt_invoice_${subscriptionId}`,
      object: "event",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_1",
          object: "invoice",
          amount_paid: 500,
          currency: "usd",
          parent: { subscription_details: { subscription: "sub_1" } },
          payments: { data: [{ payment: { payment_intent: "pi_1" } }] },
          lines: { data: [{ period: { start: 1_797_400_000, end: 1_800_000_000 } }] },
        },
      },
    }).expect(200);

    const fan = await signIn("fan@example.com");
    const orders = await fan.agent.get("/api/account/orders").expect(200);
    expect(orders.body).toHaveLength(1);
    expect(orders.body[0]).toMatchObject({ amountCents: 500, status: "paid", artist: { slug: "rachel" } });

    const subscriptions = await fan.agent.get("/api/account/subscriptions").expect(200);
    expect(subscriptions.body).toHaveLength(1);
    // The artist's term was copied onto the row; one of its months is now paid for.
    expect(subscriptions.body[0]).toMatchObject({ status: "active", priceCents: 500, artist: { slug: "rachel" }, postcardCount: 0, termMonths: 6, paidMonths: 1, cancelAtPeriodEnd: false });

    // The artist sees a name and a town, not a street.
    const artist = await signIn("artist@example.com");
    const subscribers = await artist.agent.get("/api/studio/subscribers").expect(200);
    expect(subscribers.body).toEqual([expect.objectContaining({ name: "Grandma", city: "Marfa", status: "active" })]);
    expect(JSON.stringify(subscribers.body)).not.toContain("Test Street");
    expect((await request(app).get("/api/artists/rachel").expect(200)).body.artist.subscriberCount).toBe(1);
  });
});

describe("the mailing day", () => {
  it("writes one card per active subscriber and sends it to Lob with the artist's footer", async () => {
    const { sendDueMailings, sendDuePostcards } = await import("./fulfilment.js");

    const mailed = await sendDueMailings();
    expect(mailed).toEqual({ mailed: 1, postcards: 1 });
    // Idempotent.
    expect(await sendDueMailings()).toEqual({ mailed: 0, postcards: 0 });

    const artist = await signIn("artist@example.com");
    const cards = await artist.agent.get(`/api/studio/mailings/${mailingId}/postcards`).expect(200);
    expect(cards.body).toHaveLength(1);
    expect(cards.body[0].status).toBe("scheduled");
    // Stripped for the artist: no street, no Lob text.
    expect(cards.body[0].recipient.line1).toBe("");
    postcardId = cards.body[0].id;

    sent.length = 0;
    const result = await sendDuePostcards();
    expect(result).toMatchObject({ sent: 1, failed: 0, parked: 0 });

    const call = sent.find((s) => s.url.endsWith("/v1/postcards"))!;
    expect(call.headers.get("idempotency-key")).toBe(postcardId);
    expect(call.form!.get("to[name]")).toBe("Grandma");
    expect(call.form!.get("to[address_line1]")).toBe("1 Test Street");
    expect(call.form!.get("to[address_zip]")).toBe("79843");
    expect(call.form!.get("size")).toBe("4x6");
    const back = call.form!.get("back") as string;
    expect(back).toContain("Wish you were here &lt;3");
    expect(back).toContain("Rachel");
    expect(back).toContain("a monthly postcard via");
    const front = call.form!.get("front") as Blob;
    const meta = await sharp(Buffer.from(await front.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([1875, 1275]);

    // The subscriber sees it as sent, with the proof, and no error text.
    const fan = await signIn("fan@example.com");
    const received = await fan.agent.get("/api/account/postcards").expect(200);
    expect(received.body).toHaveLength(1);
    expect(received.body[0]).toMatchObject({ status: "sent", lobUrl: "https://lob.test/proof.pdf", title: "The road", artist: { slug: "rachel" } });
    expect(received.body[0].lastError).toBeNull();

    // The gallery shows the mailing.
    const gallery = await request(app).get("/api/gallery").expect(200);
    expect(gallery.body.cards).toEqual([expect.objectContaining({ mailingId, title: "The road", artist: expect.objectContaining({ slug: "rachel" }) })]);
    expect((await request(app).get("/api/artists").expect(200)).body[0].latest.id).toBe(designId);
  });

  it("keeps a private artist's cards out of the gallery, but not off their own page", async () => {
    const { agent, csrf } = await signIn("artist@example.com");
    const profile = { slug: "rachel", name: "Rachel", tagline: "photos from the road", bio: "**Hi.**", monthlyPriceCents: 500, sendDay: 15 };

    const hidden = await agent.put("/api/studio/profile").set("x-csrf-token", csrf).send({ ...profile, visibility: "private" }).expect(200);
    expect(hidden.body.artist.visibility).toBe("private");

    // The shared feed is empty; the artist is still listed, still subscribable, and their page still shows the card.
    expect((await request(app).get("/api/gallery").expect(200)).body.cards).toEqual([]);
    const listed = (await request(app).get("/api/artists").expect(200)).body as { slug: string }[];
    expect(listed.map((a) => a.slug)).toEqual(["rachel"]);
    const page = await request(app).get("/api/artists/rachel").expect(200);
    expect(page.body.artist.status).toBe("live");
    expect(page.body.recent).toEqual([expect.objectContaining({ mailingId })]);

    // Back to public: the card is in the feed again. Nothing about the mailing itself changed.
    await agent.put("/api/studio/profile").set("x-csrf-token", csrf).send({ ...profile, visibility: "public" }).expect(200);
    expect((await request(app).get("/api/gallery").expect(200)).body.cards).toEqual([expect.objectContaining({ mailingId })]);
  });

  it("records the artist's share in the ledger the moment Lob accepts the card", async () => {
    const artist = await signIn("artist@example.com");
    const earnings = await artist.agent.get("/api/studio/earnings").expect(200);
    expect(earnings.body).toMatchObject({ pendingCents: 320, paidCents: 0, sentCount: 1, currency: "USD" });
    expect(earnings.body.payouts).toEqual([expect.objectContaining({ postcardId, grossCents: 500, printCostCents: 120, platformFeeCents: 60, amountCents: 320, status: "pending" })]);
  });
});

describe("paying the artist", () => {
  it("waits for Stripe onboarding, then transfers each card's share once", async () => {
    const { sendPendingPayouts } = await import("./fulfilment.js");
    const transfers = vi.spyOn(stripe.transfers, "create").mockImplementation((() => Promise.resolve({ id: "tr_1" })) as never);

    // Not onboarded: nothing moves, nothing is asked of Stripe.
    expect(await sendPendingPayouts()).toMatchObject({ paid: 0, failed: 0, deferred: 0 });
    expect(transfers).not.toHaveBeenCalled();

    // Onboarding finishes: Stripe says so through the Connect webhook.
    const { setArtistStripeAccount } = await import("../db/artists-repository.js");
    await setArtistStripeAccount(artistId, "acct_rachel", false);
    await webhook({ id: "evt_account_1", object: "event", type: "account.updated", data: { object: { id: "acct_rachel", object: "account", payouts_enabled: true } } }).expect(200);

    expect(await sendPendingPayouts()).toMatchObject({ paid: 1, failed: 0, deferred: 0 });
    expect(transfers).toHaveBeenCalledTimes(1);
    const [params, options] = transfers.mock.calls[0] as unknown as [Stripe.TransferCreateParams, { idempotencyKey: string }];
    expect(params).toMatchObject({ amount: 320, currency: "usd", destination: "acct_rachel", transfer_group: mailingId });
    expect(options.idempotencyKey).toMatch(/^payout-/);

    // Paid once: a second sweep finds nothing.
    expect(await sendPendingPayouts()).toMatchObject({ paid: 0 });
    expect(transfers).toHaveBeenCalledTimes(1);

    const artist = await signIn("artist@example.com");
    const earnings = await artist.agent.get("/api/studio/earnings").expect(200);
    expect(earnings.body).toMatchObject({ pendingCents: 0, paidCents: 320 });
    expect(earnings.body.payouts[0]).toMatchObject({ status: "paid", stripeTransferId: "tr_1" });

    const admin = await signInAdmin();
    const overview = await admin.agent.get("/api/admin/overview").expect(200);
    expect(overview.body.payouts.paid).toBe(320);
    expect(overview.body.revenueCents).toBe(500);
  });

  it("defers a transfer while the platform balance is still settling, and parks a real refusal", async () => {
    const { sendPendingPayouts } = await import("./fulfilment.js");
    const { listPayoutsForArtist } = await import("../db/payouts-repository.js");
    const { getDatabase } = await import("../db/client.js");
    const { eq } = await import("drizzle-orm");
    const StripeLib = (await import("stripe")).default;

    // Put the one ledger row back to pending, as if never transferred.
    const { drizzle: db, schema } = await getDatabase();
    await db.update(schema.payouts).set({ status: "pending", stripeTransferId: null, attempts: 0 }).where(eq(schema.payouts.artistId, artistId));

    const refusal = new StripeLib.errors.StripeInvalidRequestError({ type: "invalid_request_error", message: "Insufficient funds", code: "balance_insufficient" } as never);
    vi.spyOn(stripe.transfers, "create").mockRejectedValueOnce(refusal);
    expect(await sendPendingPayouts()).toMatchObject({ paid: 0, failed: 0, deferred: 1 });
    const deferred = (await listPayoutsForArtist(artistId))[0]!;
    expect(deferred.status).toBe("pending");
    expect(deferred.lastError).toContain("Insufficient funds");

    // A refusal that will not change parks it for the admin, who can retry.
    const permanent = new StripeLib.errors.StripeInvalidRequestError({ type: "invalid_request_error", message: "No such destination", code: "resource_missing" } as never);
    vi.spyOn(stripe.transfers, "create").mockRejectedValueOnce(permanent);
    expect(await sendPendingPayouts()).toMatchObject({ paid: 0, failed: 1, deferred: 0 });

    const admin = await signInAdmin();
    const listed = await admin.agent.get("/api/admin/payouts?status=failed").expect(200);
    expect(listed.body.payouts[0].lastError).toContain("No such destination");
    await admin.agent.post(`/api/admin/payouts/${listed.body.payouts[0].id}/retry`).set("x-csrf-token", admin.csrf).expect(204);

    vi.spyOn(stripe.transfers, "create").mockImplementation((() => Promise.resolve({ id: "tr_2" })) as never);
    expect(await sendPendingPayouts()).toMatchObject({ paid: 1 });
    expect((await listPayoutsForArtist(artistId))[0]).toMatchObject({ status: "paid", stripeTransferId: "tr_2" });
  });
});

describe("Lob refuses a card", () => {
  it("parks it with Lob's words for the admin, who retries it", async () => {
    const { getDatabase } = await import("../db/client.js");
    const { eq } = await import("drizzle-orm");
    const { drizzle: db, schema } = await getDatabase();
    await db.update(schema.postcards).set({ status: "scheduled", lobId: null, attempts: 0 }).where(eq(schema.postcards.id, postcardId));

    lobAnswer = () => new Response(JSON.stringify({ error: { message: "to[address_zip] is not a valid zip code", status_code: 422 } }), { status: 422, headers: { "content-type": "application/json" } });
    const { sendDuePostcards } = await import("./fulfilment.js");
    expect(await sendDuePostcards()).toMatchObject({ sent: 0, parked: 1 });

    const admin = await signInAdmin();
    const errors = await admin.agent.get("/api/admin/postcards/errors").expect(200);
    expect(errors.body[0]).toMatchObject({ id: postcardId, status: "error" });
    expect(errors.body[0].lastError).toContain("to[address_zip] is not a valid zip code");

    // The subscriber is told nothing of Lob's; the artist neither.
    const fan = await signIn("fan@example.com");
    const received = await fan.agent.get("/api/account/postcards").expect(200);
    expect(received.body[0].status).toBe("error");
    expect(received.body[0].lastError).toBeNull();

    await admin.agent.post(`/api/admin/postcards/${postcardId}/retry`).set("x-csrf-token", admin.csrf).expect(200);
    lobAnswer = () => new Response(JSON.stringify({ id: "psc_test_2", url: null, expected_delivery_date: null }), { status: 200, headers: { "content-type": "application/json" } });
    expect(await sendDuePostcards()).toMatchObject({ sent: 1 });
    // The ledger already had this card: no second share.
    const { listPayoutsForArtist } = await import("../db/payouts-repository.js");
    expect((await listPayoutsForArtist(artistId)).filter((p) => p.postcardId === postcardId)).toHaveLength(1);
  });
});

describe("the term", () => {
  it("tells Stripe to stop after the last paid month, and will not resume past it", async () => {
    const { getDatabase } = await import("../db/client.js");
    const { eq } = await import("drizzle-orm");
    const { drizzle: db, schema } = await getDatabase();
    // As if the artist had set two months when this fan subscribed.
    await db.update(schema.subscriptions).set({ termMonths: 2 }).where(eq(schema.subscriptions.id, subscriptionId));

    const update = vi.spyOn(stripe.subscriptions, "update");
    update.mockClear();

    // The second month is paid for: that is the last of the two, so Stripe is told to end it there.
    await webhook({
      id: `evt_invoice_2_${subscriptionId}`,
      object: "event",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_2",
          object: "invoice",
          amount_paid: 500,
          currency: "usd",
          parent: { subscription_details: { subscription: "sub_1" } },
          payments: { data: [{ payment: { payment_intent: "pi_2" } }] },
          lines: { data: [{ period: { start: 1_800_000_000, end: 1_802_600_000 } }] },
        },
      },
    }).expect(200);
    expect(update.mock.calls).toEqual([["sub_1", { cancel_at_period_end: true }]]);

    const fan = await signIn("fan@example.com");
    const listed = await fan.agent.get("/api/account/subscriptions").expect(200);
    expect(listed.body[0]).toMatchObject({ status: "active", termMonths: 2, paidMonths: 2, cancelAtPeriodEnd: true, currentPeriodEnd: 1_802_600_000_000 });

    // Over is over: the fan can subscribe again, not undo the end.
    const resume = await fan.agent.post(`/api/account/subscriptions/${subscriptionId}/resume`).set("x-csrf-token", fan.csrf);
    expect(resume.status).toBe(409);
    expect(resume.body.error).toMatch(/2 months/);

    // A redelivery asks Stripe for the same thing once more and changes nothing else.
    update.mockClear();
    await webhook({
      id: `evt_invoice_2_again_${subscriptionId}`,
      object: "event",
      type: "invoice.paid",
      data: { object: { id: "in_2", object: "invoice", amount_paid: 500, currency: "usd", parent: { subscription_details: { subscription: "sub_1" } }, lines: { data: [] } } },
    }).expect(200);
    expect(update.mock.calls).toEqual([]);
    expect((await fan.agent.get("/api/account/orders").expect(200)).body).toHaveLength(2);

    // Put the term back the way it was so the cancelling story below reads as before.
    const { setCancelAtPeriodEnd } = await import("../db/subscriptions-repository.js");
    await db.update(schema.subscriptions).set({ termMonths: 6 }).where(eq(schema.subscriptions.id, subscriptionId));
    await setCancelAtPeriodEnd(subscriptionId, false);
  });
});

describe("cancelling", () => {
  it("winds down at the period end, and Stripe's final word ends it", async () => {
    const fan = await signIn("fan@example.com");
    await fan.agent.post(`/api/account/subscriptions/${subscriptionId}/cancel`).set("x-csrf-token", fan.csrf).expect(204);
    const update = vi.spyOn(stripe.subscriptions, "update");
    expect(update.mock.calls.at(-1)).toEqual(["sub_1", { cancel_at_period_end: true }]);
    let listed = await fan.agent.get("/api/account/subscriptions").expect(200);
    expect(listed.body[0]).toMatchObject({ status: "active", cancelAtPeriodEnd: true, postcardCount: 1 });

    await fan.agent.post(`/api/account/subscriptions/${subscriptionId}/resume`).set("x-csrf-token", fan.csrf).expect(204);
    listed = await fan.agent.get("/api/account/subscriptions").expect(200);
    expect(listed.body[0].cancelAtPeriodEnd).toBe(false);

    await webhook({ id: "evt_deleted_1", object: "event", type: "customer.subscription.deleted", data: { object: { id: "sub_1", object: "subscription", status: "canceled", cancel_at_period_end: false } } }).expect(200);
    listed = await fan.agent.get("/api/account/subscriptions").expect(200);
    expect(listed.body[0]).toMatchObject({ status: "cancelled" });
    expect(listed.body[0].cancelledAt).toBeTypeOf("number");

    // Cancelled: the next mailing writes no card for them.
    const { listActiveSubscriptionsForArtist } = await import("../db/subscriptions-repository.js");
    expect(await listActiveSubscriptionsForArtist(artistId)).toHaveLength(0);
    expect((await request(app).get("/api/artists/rachel").expect(200)).body.artist.subscriberCount).toBe(0);

    // Someone else's subscription is a 404 to them.
    const other = await signIn("artist@example.com");
    await other.agent.post(`/api/account/subscriptions/${subscriptionId}/cancel`).set("x-csrf-token", other.csrf).expect(404);
  });
});
