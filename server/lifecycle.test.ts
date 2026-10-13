import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Stripe from "stripe";
import sharp from "sharp";
import { addDaysIso, todayIso } from "../shared/postcards.js";
import { editionSchedule } from "../shared/platform.js";

/**
 * The whole life of an edition, end to end, against a fake Lob and a stubbed
 * Stripe.
 *
 * An artist makes a page, builds an edition of six cards and sends it for
 * review; the admin approves the page and the edition, which puts it on
 * sale, and the artist goes live; a collector pays once, picking the day it starts (Checkout
 * is stubbed, the signed webhook is real) and every card of their run is
 * written on its day; the print sweep sends each as its day comes and the
 * ledger records the artist's share of it; the payout sweep transfers it
 * once the artist can be paid; a refund withdraws the rest. What is
 * asserted is what each outside party is *sent* and what each kind of
 * answer does to the rows.
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
let artistBanner: Record<string, unknown> = {};
let editionId = "";
let purchaseId = "";
let checkoutSessionId = "";
let postcardId = "";
let schedule: string[] = [];

/** The collector's chosen first day: a few days out, on a day every month has, and not the default 1st or 15th. */
function chosenStartDate(): string {
  for (let offset = 3; ; offset += 1) {
    const candidate = addDaysIso(todayIso(), offset);
    const day = Number(candidate.slice(8));
    if (day <= 28 && day !== 1 && day !== 15) return candidate;
  }
}

const EDITION: { slug: string; title: string; description: string; cardCount: number; priceCents: number; banner: { path: string; alt: string } | null } = {
  slug: "birds",
  title: "Birds of Marfa",
  description: "Six *birds*.",
  cardCount: 6,
  priceCents: 3000,
  banner: null,
};

describe("an artist makes an edition", () => {
  it("creates the page, builds a set of six, sends it for review, is approved, and goes live", async () => {
    const { agent, csrf } = await signIn("artist@example.com");
    // Without SMTP every email is logged instead; the log is what says who was told what.
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const emailed = (subject: string, to: string) => vi.waitFor(() => expect(log.mock.calls.map((call) => String(call[0]))).toContainEqual(expect.stringContaining(`would have sent "${subject}" to ${to}`)));

    // A page always has a picture across the top, so it is uploaded before the page exists.
    const withoutBanner = await agent.post("/api/studio").set("x-csrf-token", csrf).send({ slug: "rachel", name: "Rachel", bio: "**Hi.**" });
    expect(withoutBanner.status).toBe(400);
    const bannerPng = await sharp({ create: { width: 900, height: 300, channels: 3, background: "#ffcc00" } }).png().toBuffer();
    const banner = await agent.post("/api/studio/banner").set("x-csrf-token", csrf).attach("file", bannerPng, { filename: "banner.png", contentType: "image/png" }).expect(201);
    artistBanner = banner.body as Record<string, unknown>;
    const created = await agent.post("/api/studio").set("x-csrf-token", csrf).send({ slug: "rachel", name: "Rachel", bio: "**Hi.**", banner: artistBanner }).expect(201);
    artistId = created.body.artist.id;
    expect(created.body.artist).toMatchObject({ status: "draft", reviewStatus: "pending", reviewNote: null, links: [], banner: { path: banner.body.path, width: 900, height: 300 } });
    // Opening a studio is the first thing the admin hears about.
    await emailed("Rachel opened a studio", "admin@example.com");
    expect((await agent.get("/api/account").expect(200)).body.customer).toMatchObject({ artistSlug: "rachel", artistReviewStatus: "pending", editionsInReview: 0 });

    // Where else to find them. A link without a proper address is refused.
    const badLink = await agent.put("/api/studio/profile").set("x-csrf-token", csrf).send({ slug: "rachel", name: "Rachel", banner: artistBanner, links: [{ label: "Instagram", url: "instagram.com/rachel" }] });
    expect(badLink.status).toBe(400);
    const profile = await agent
      .put("/api/studio/profile")
      .set("x-csrf-token", csrf)
      .send({ slug: "rachel", name: "Rachel", bio: "**Hi.**", banner: artistBanner, links: [{ label: "Instagram", url: "https://instagram.com/rachel" }] })
      .expect(200);
    expect(profile.body.artist.banner).toMatchObject({ path: banner.body.path, width: 900, height: 300 });

    // Not approved, and nothing on sale: nothing to go live with.
    expect((await agent.post("/api/studio/status").set("x-csrf-token", csrf).send({ status: "live" })).status).toBe(409);

    const designIds: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: i === 0 ? "#00ffff" : "#ff00ff" } }).png().toBuffer();
      const uploaded = await agent
        .post("/api/studio/designs")
        .set("x-csrf-token", csrf)
        .field("orientation", "landscape")
        .attach("file", png, { filename: "a.png", contentType: "image/png" })
        .expect(201);
      designIds.push(uploaded.body.id as string);
    }

    const edition = await agent.post("/api/studio/editions").set("x-csrf-token", csrf).send(EDITION).expect(201);
    editionId = edition.body.id;
    expect(edition.body).toMatchObject({ status: "draft", cards: [], cardCount: 6, priceCents: 3000 });

    // Five cards are not a set of six.
    await agent.put(`/api/studio/editions/${editionId}/cards`).set("x-csrf-token", csrf).send({ cards: designIds.slice(0, 5).map((designId) => ({ designId })) }).expect(200);

    // A card taken out of the set takes its upload with it: nothing else could show it.
    await agent.put(`/api/studio/editions/${editionId}/cards`).set("x-csrf-token", csrf).send({ cards: designIds.slice(0, 4).map((designId) => ({ designId })) }).expect(200);
    expect((await agent.delete(`/api/studio/designs/${designIds[4]}`).set("x-csrf-token", csrf)).status).toBe(404);
    const again = await agent
      .post("/api/studio/designs")
      .set("x-csrf-token", csrf)
      .field("orientation", "landscape")
      .attach("file", await sharp({ create: { width: 300, height: 200, channels: 3, background: "#ff00ff" } }).png().toBuffer(), { filename: "a.png", contentType: "image/png" })
      .expect(201);
    designIds[4] = again.body.id as string;
    const short = await agent.post(`/api/studio/editions/${editionId}/status`).set("x-csrf-token", csrf).send({ status: "in_review" });
    expect(short.status).toBe(409);
    expect(short.body.error).toMatch(/all 6 cards/);

    const full = await agent
      .put(`/api/studio/editions/${editionId}/cards`)
      .set("x-csrf-token", csrf)
      .send({ cards: designIds.map((designId, i) => ({ designId, title: i === 0 ? "The road <3" : null })) })
      .expect(200);
    expect((full.body.cards as { position: number }[]).map((c) => c.position)).toEqual([1, 2, 3, 4, 5, 6]);

    // The cards are a surprise: the banner is what visitors see instead, so it is needed first.
    const bare = await agent.post(`/api/studio/editions/${editionId}/status`).set("x-csrf-token", csrf).send({ status: "in_review" });
    expect(bare.status).toBe(409);
    expect(bare.body.error).toMatch(/banner/);
    const editionBanner = await agent.post("/api/studio/editions/banner").set("x-csrf-token", csrf).field("alt", "Birds on a wire").attach("file", bannerPng, { filename: "birds.png", contentType: "image/png" }).expect(201);
    EDITION.banner = editionBanner.body as typeof EDITION.banner;
    await agent.put(`/api/studio/editions/${editionId}`).set("x-csrf-token", csrf).send(EDITION).expect(200);

    // The artist cannot put it on sale; only the admin can, from review.
    expect((await agent.post(`/api/studio/editions/${editionId}/status`).set("x-csrf-token", csrf).send({ status: "on_sale" })).status).toBe(409);
    const sent = await agent.post(`/api/studio/editions/${editionId}/status`).set("x-csrf-token", csrf).send({ status: "in_review" }).expect(200);
    expect(sent.body.status).toBe("in_review");
    await emailed("Rachel sent Birds of Marfa for review", "admin@example.com");
    expect((await agent.get("/api/account").expect(200)).body.customer.editionsInReview).toBe(1);
    // In review nothing changes, and nobody sees it.
    expect((await agent.put(`/api/studio/editions/${editionId}`).set("x-csrf-token", csrf).send({ ...EDITION, title: "Changed" })).status).toBe(409);
    expect((await agent.put(`/api/studio/editions/${editionId}/cards`).set("x-csrf-token", csrf).send({ cards: [] })).status).toBe(409);
    expect((await request(app).get("/api/gallery").expect(200)).body).toEqual({ editions: [], nextCursor: null });

    // The admin's queue has the page and the edition, with every card to look at.
    const admin = await signInAdmin();
    const queue = await admin.agent.get("/api/admin/review").expect(200);
    expect(queue.body.artists).toEqual([expect.objectContaining({ id: artistId, slug: "rachel", bio: "**Hi.**", reviewStatus: "pending" })]);
    expect(queue.body.editions).toEqual([expect.objectContaining({ id: editionId, title: "Birds of Marfa", artist: expect.objectContaining({ id: artistId, reviewStatus: "pending" }) })]);
    expect((queue.body.editions[0].cards as unknown[]).length).toBe(6);
    expect((await admin.agent.get("/api/admin/overview").expect(200)).body.review).toEqual({ artists: 1, editions: 1 });

    // The page comes first: an edition is not approved before its artist is.
    const early = await admin.agent.post(`/api/admin/editions/${editionId}/review`).set("x-csrf-token", admin.csrf).send({ decision: "approved" });
    expect(early.status).toBe(409);
    // A no comes with a word to the artist, and sends the edition back to a draft with it.
    await admin.agent.post(`/api/admin/editions/${editionId}/review`).set("x-csrf-token", admin.csrf).send({ decision: "declined", note: "Card 3 is blurry." }).expect(204);
    await emailed("About Birds of Marfa", "artist@example.com");
    const declined = await agent.get(`/api/studio/editions/${editionId}`).expect(200);
    expect(declined.body).toMatchObject({ status: "draft", reviewNote: "Card 3 is blurry." });
    // Sent again, the note goes with it.
    expect((await agent.post(`/api/studio/editions/${editionId}/status`).set("x-csrf-token", csrf).send({ status: "in_review" }).expect(200)).body.reviewNote).toBeNull();

    await admin.agent.post(`/api/admin/artists/${artistId}/review`).set("x-csrf-token", admin.csrf).send({ decision: "approved" }).expect(204);
    await emailed("Your studio is approved", "artist@example.com");
    expect((await agent.get("/api/studio").expect(200)).body.artist).toMatchObject({ reviewStatus: "approved", status: "draft" });
    await admin.agent.post(`/api/admin/editions/${editionId}/review`).set("x-csrf-token", admin.csrf).send({ decision: "approved" }).expect(204);
    await emailed("Birds of Marfa is on sale", "artist@example.com");
    // Decided once: a second decision finds nothing in review.
    expect((await admin.agent.post(`/api/admin/editions/${editionId}/review`).set("x-csrf-token", admin.csrf).send({ decision: "declined" })).status).toBe(409);
    expect((await admin.agent.get("/api/admin/review").expect(200)).body).toEqual({ artists: [], editions: [] });
    const onSale = await agent.get(`/api/studio/editions/${editionId}`).expect(200);
    expect(onSale.body.status).toBe("on_sale");
    log.mockRestore();

    // On sale: the price is fixed, the words are not; the cards' backs are fixed too.
    const reprice = await agent.put(`/api/studio/editions/${editionId}`).set("x-csrf-token", csrf).send({ ...EDITION, priceCents: 100 });
    expect(reprice.status).toBe(409);
    const retitled = await agent.put(`/api/studio/editions/${editionId}`).set("x-csrf-token", csrf).send({ ...EDITION, title: "Birds" }).expect(200);
    expect(retitled.body.title).toBe("Birds");
    // The banner can change, but an edition on sale can't be left without one.
    expect(retitled.body.banner).toMatchObject({ alt: "Birds on a wire" });
    expect((await agent.put(`/api/studio/editions/${editionId}`).set("x-csrf-token", csrf).send({ ...EDITION, banner: null })).status).toBe(409);
    await agent.put(`/api/studio/editions/${editionId}`).set("x-csrf-token", csrf).send(EDITION).expect(200);
    expect((await agent.delete(`/api/studio/designs/${designIds[0]}`).set("x-csrf-token", csrf)).status).toBe(409);

    // On sale, but the artist is still a draft: the gallery has nothing to show yet.
    expect((await request(app).get("/api/gallery").expect(200)).body).toEqual({ editions: [], nextCursor: null });

    const live = await agent.post("/api/studio/status").set("x-csrf-token", csrf).send({ status: "live" }).expect(200);
    expect(live.body.artist.status).toBe("live");

    // Now public: the gallery lists the edition with its artist, and the page lists the edition.
    const gallery = await request(app).get("/api/gallery").expect(200);
    expect(gallery.body.editions).toEqual([expect.objectContaining({ slug: "birds", title: "Birds of Marfa", priceCents: 3000, artist: expect.objectContaining({ slug: "rachel", name: "Rachel" }) })]);
    expect(JSON.stringify(gallery.body)).not.toContain(designIds[0]!);
    const page = await request(app).get("/api/artists/rachel").expect(200);
    expect(page.body.artist.bioHtml).toContain("<strong>Hi.</strong>");
    expect(page.body.artist.collectorCount).toBe(0);
    expect(page.body.editions).toEqual([expect.objectContaining({ slug: "birds", title: "Birds of Marfa", priceCents: 3000, banner: expect.objectContaining({ alt: "Birds on a wire" }) })]);
    const shown = await request(app).get("/api/artists/rachel/editions/birds").expect(200);
    expect(shown.body.edition.descriptionHtml).toContain("<em>birds</em>");
    expect(shown.body.edition.banner).toMatchObject({ alt: "Birds on a wire" });
    // A surprise: no card, and no design, reaches a visitor before it is mailed.
    expect(shown.body.edition.cards).toBeUndefined();
    expect(JSON.stringify(shown.body)).not.toContain(designIds[1]!);
    expect(JSON.stringify(page.body)).not.toContain(designIds[1]!);
    expect(page.body.recent).toBeUndefined();
    await request(app).get("/api/artists/rachel/editions/nope").expect(404);
    const listed = (await request(app).get("/api/artists").expect(200)).body as { slug: string; fromPriceCents: number; editionCount: number }[];
    expect(listed).toEqual([expect.objectContaining({ slug: "rachel", fromPriceCents: 3000, editionCount: 1, banner: expect.objectContaining({ path: artistBanner.path }) })]);
  });
});

describe("a fan collects the edition", () => {
  it("starts a one-time Checkout at the edition's price, on the day they chose, as often as they chose", async () => {
    const { agent, csrf } = await signIn("fan@example.com");
    const startDate = chosenStartDate();

    // A day that has passed, or one some months lack, is refused before Stripe is asked.
    const past = await agent.post("/api/checkout/collect").set("x-csrf-token", csrf).send({ editionId, address: ADDRESS, startDate: todayIso() });
    expect(past.status).toBe(400);
    expect(past.body.error).toMatch(/after today/);

    const response = await agent.post("/api/checkout/collect").set("x-csrf-token", csrf).send({ editionId, address: ADDRESS, startDate, priceCents: 1 }).expect(200);
    purchaseId = response.body.purchaseId;
    expect(response.body.url).toContain("checkout.stripe.com");

    const params = (stripe.checkout.sessions.create as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as Stripe.Checkout.SessionCreateParams;
    expect(params.mode).toBe("payment");
    expect(params.customer).toBe("cus_fan");
    expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(3000);
    expect(params.line_items?.[0]?.price_data?.recurring).toBeUndefined();
    expect(params.metadata?.yiwap_purchase_id).toBe(purchaseId);
    expect(params.payment_intent_data?.metadata?.yiwap_purchase_id).toBe(purchaseId);

    const { getPurchase, findPurchaseByCheckoutSession } = await import("../db/purchases-repository.js");
    const row = (await getPurchase(purchaseId))!;
    checkoutSessionId = row.stripeCheckoutSessionId;
    expect(row).toMatchObject({ status: "incomplete", priceCents: 3000, cardCount: 6, cadence: "monthly", startDate });
    expect(await findPurchaseByCheckoutSession(checkoutSessionId)).toMatchObject({ id: purchaseId });
    schedule = editionSchedule(startDate, 6, "monthly");

    // The address went through USPS and, the account having none, onto it.
    expect(sent.some((s) => s.url.endsWith("/us_verifications"))).toBe(true);
    const me = await agent.get("/api/account").expect(200);
    expect(me.body.customer.address).toMatchObject({ line1: "1 Test Street" });

    // The confirmation page sees it as still confirming; nobody else sees it at all.
    const pending = await agent.get(`/api/checkout/${checkoutSessionId}`).expect(200);
    expect(pending.body).toMatchObject({ status: "incomplete", sentCount: 0, schedule: [] });
    const other = await signIn("artist@example.com");
    await other.agent.get(`/api/checkout/${checkoutSessionId}`).expect(404);
  });

  it("starts on the next 1st or 15th when no day is given, and refuses the artist's own", async () => {
    const fan = await signIn("fan@example.com");
    // Not paid yet: the incomplete one does not block a retry. The cadence is
    // the collector's, snapshotted on the purchase; an edition has none.
    const retry = await fan.agent.post("/api/checkout/collect").set("x-csrf-token", fan.csrf).send({ editionId, address: ADDRESS, cadence: "twice_monthly" }).expect(200);
    const { getPurchase, deleteIncompletePurchase } = await import("../db/purchases-repository.js");
    const retried = (await getPurchase(retry.body.purchaseId as string))!;
    expect(["01", "15"]).toContain(retried.startDate.slice(8));
    expect(retried.cadence).toBe("twice_monthly");
    await deleteIncompletePurchase(retry.body.purchaseId as string);

    // A different address: the set gets it, the account keeps its own.
    const gift = { ...ADDRESS, name: "Aunt May", line1: "5 Gift Lane" };
    const given = await fan.agent.post("/api/checkout/collect").set("x-csrf-token", fan.csrf).send({ editionId, address: gift }).expect(200);
    expect((await getPurchase(given.body.purchaseId as string))!.address.line1).toBe("5 Gift Lane");
    expect((await fan.agent.get("/api/account").expect(200)).body.customer.address.line1).toBe("1 Test Street");
    await deleteIncompletePurchase(given.body.purchaseId as string);

    const self = await signIn("artist@example.com");
    const response = await self.agent.post("/api/checkout/collect").set("x-csrf-token", self.csrf).send({ editionId, address: ADDRESS });
    expect(response.status).toBe(409);
  });

  it("is paid only when the signed webhook says so, and every card of the run is written on its day", async () => {
    // Checkout completed but the money has not arrived: nothing yet.
    await webhook({
      id: `evt_unpaid_${purchaseId}`,
      object: "event",
      type: "checkout.session.completed",
      data: { object: { id: checkoutSessionId, object: "checkout.session", mode: "payment", payment_status: "unpaid", payment_intent: "pi_1", metadata: { yiwap_purchase_id: purchaseId } } },
    }).expect(200);
    const { getPurchase } = await import("../db/purchases-repository.js");
    expect((await getPurchase(purchaseId))!.status).toBe("incomplete");

    const completed = { id: checkoutSessionId, object: "checkout.session", mode: "payment", payment_status: "paid", payment_intent: "pi_1", metadata: { yiwap_purchase_id: purchaseId } };
    await webhook({ id: `evt_completed_${purchaseId}`, object: "event", type: "checkout.session.completed", data: { object: completed } }).expect(200);
    expect(await getPurchase(purchaseId)).toMatchObject({ status: "paid", stripePaymentIntentId: "pi_1", paidAt: expect.any(Number) });

    // A replay is a no-op.
    const replay = await webhook({ id: `evt_completed_${purchaseId}`, object: "event", type: "checkout.session.completed", data: { object: completed } }).expect(200);
    expect(replay.body.duplicate).toBe(true);

    const fan = await signIn("fan@example.com");
    const collections = await fan.agent.get("/api/account/collections").expect(200);
    expect(collections.body).toHaveLength(1);
    expect(collections.body[0]).toMatchObject({
      status: "paid",
      priceCents: 3000,
      cardCount: 6,
      sentCount: 0,
      nextMailDate: schedule[0],
      artist: { slug: "rachel" },
      edition: { slug: "birds", title: "Birds of Marfa" },
    });
    expect((collections.body[0].schedule as { mailDate: string }[]).map((c) => c.mailDate)).toEqual(schedule);

    // One run of an edition at a time.
    const again = await fan.agent.post("/api/checkout/collect").set("x-csrf-token", fan.csrf).send({ editionId, address: ADDRESS });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already collecting/);

    // The artist learns only that the count went up: there is no list of who collects.
    const artist = await signIn("artist@example.com");
    expect((await artist.agent.get("/api/studio/collectors")).status).toBe(404);
    const studio = await artist.agent.get("/api/studio").expect(200);
    expect(studio.body.artist.collectorCount).toBe(1);
    for (const secret of ["Grandma", "Test Street", "79843"]) expect(JSON.stringify(studio.body)).not.toContain(secret);
    expect((await request(app).get("/api/artists/rachel").expect(200)).body.artist.collectorCount).toBe(1);

    // Bought once: the edition can no longer go back to being a draft.
    const back = await artist.agent.post(`/api/studio/editions/${editionId}/status`).set("x-csrf-token", artist.csrf).send({ status: "draft" });
    expect(back.status).toBe(409);
  });
});

describe("the first card's day", () => {
  it("sends nothing early, then sends card 1 to Lob with its title and the artist's name on the back", async () => {
    const { sendDuePostcards } = await import("./fulfilment.js");

    sent.length = 0;
    expect(await sendDuePostcards(addDaysIso(schedule[0]!, -1))).toMatchObject({ sent: 0 });
    expect(sent.filter((s) => s.url.endsWith("/v1/postcards"))).toHaveLength(0);

    const result = await sendDuePostcards(schedule[0]);
    expect(result).toMatchObject({ sent: 1, failed: 0, parked: 0 });

    const call = sent.find((s) => s.url.endsWith("/v1/postcards"))!;
    postcardId = call.headers.get("idempotency-key")!;
    expect(call.form!.get("to[name]")).toBe("Grandma");
    expect(call.form!.get("to[address_line1]")).toBe("1 Test Street");
    expect(call.form!.get("size")).toBe("4x6");
    const back = call.form!.get("back") as string;
    expect(back).toContain("The road &lt;3");
    expect(back).toContain("Rachel");
    expect(back).toContain("A postcard edition from");
    const front = call.form!.get("front") as Blob;
    const meta = await sharp(Buffer.from(await front.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([1875, 1275]);

    // Only card 1 was due.
    expect(await sendDuePostcards(schedule[0])).toMatchObject({ sent: 0 });

    // The collector sees it as sent, with the proof, and no error text; the rest are on the schedule.
    const fan = await signIn("fan@example.com");
    const received = await fan.agent.get("/api/account/postcards").expect(200);
    expect(received.body).toHaveLength(1);
    expect(received.body[0]).toMatchObject({ status: "sent", position: 1, cardCount: 6, lobUrl: "https://lob.test/proof.pdf", title: "The road <3", artist: { slug: "rachel" }, edition: { slug: "birds" } });
    expect(received.body[0].lastError).toBeNull();
    const collections = await fan.agent.get("/api/account/collections").expect(200);
    expect(collections.body[0]).toMatchObject({ sentCount: 1, nextMailDate: schedule[1] });

    // The card that went stays a surprise to everyone else: neither the artist's page nor the gallery shows it.
    const page = await request(app).get("/api/artists/rachel").expect(200);
    expect(JSON.stringify(page.body)).not.toContain("The road");
    expect(JSON.stringify((await request(app).get("/api/gallery").expect(200)).body)).not.toContain("The road");
  });

  it("keeps a private artist's editions out of the gallery, but not off their own page", async () => {
    const { agent, csrf } = await signIn("artist@example.com");
    const profile = { slug: "rachel", name: "Rachel", bio: "**Hi.**", banner: artistBanner };

    const hidden = await agent.put("/api/studio/profile").set("x-csrf-token", csrf).send({ ...profile, visibility: "private" }).expect(200);
    expect(hidden.body.artist.visibility).toBe("private");

    expect((await request(app).get("/api/gallery").expect(200)).body.editions).toEqual([]);
    const page = await request(app).get("/api/artists/rachel").expect(200);
    expect(page.body.artist.status).toBe("live");
    expect(page.body.editions).toHaveLength(1);

    await agent.put("/api/studio/profile").set("x-csrf-token", csrf).send({ ...profile, visibility: "public" }).expect(200);
    expect((await request(app).get("/api/gallery").expect(200)).body.editions).toHaveLength(1);
  });


  it("records the card's share of the price in the ledger the moment Lob accepts it", async () => {
    // $30 over six cards is $5 a card; less $1.20 to print and $0.60 to the platform. The artist sees the totals on their overview.
    const artist = await signIn("artist@example.com");
    const studio = await artist.agent.get("/api/studio").expect(200);
    expect(studio.body.earnings).toEqual({ pendingCents: 230, paidCents: 0, currency: "USD" });
    expect(studio.body.artist.mailedCount).toBe(1);
    // The ledger itself is the admin's.
    const admin = await signInAdmin();
    const ledger = await admin.agent.get("/api/admin/payouts").expect(200);
    expect(ledger.body.payouts).toEqual([expect.objectContaining({ postcardId, purchaseId, grossCents: 500, printCostCents: 120, platformFeeCents: 150, amountCents: 230, status: "pending" })]);
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
    expect(params).toMatchObject({ amount: 230, currency: "usd", destination: "acct_rachel", transfer_group: purchaseId });
    expect(options.idempotencyKey).toMatch(/^payout-/);

    // Paid once: a second sweep finds nothing.
    expect(await sendPendingPayouts()).toMatchObject({ paid: 0 });
    expect(transfers).toHaveBeenCalledTimes(1);

    const admin = await signInAdmin();
    const overview = await admin.agent.get("/api/admin/overview").expect(200);
    expect(overview.body.payouts.paid).toBe(230);
    expect(overview.body.revenueCents).toBe(3000);
    expect(overview.body.purchases.paid).toBe(1);
    expect(overview.body.editions.on_sale).toBe(1);
  });

  it("defers a transfer while the platform balance is still settling, and parks a real refusal", async () => {
    const { sendPendingPayouts } = await import("./fulfilment.js");
    const { listPayoutsForArtist } = await import("../db/payouts-repository.js");
    const { getDatabase } = await import("../db/client.js");
    const { eq } = await import("drizzle-orm");
    const StripeLib = (await import("stripe")).default;

    const { drizzle: db, schema } = await getDatabase();
    await db.update(schema.payouts).set({ status: "pending", stripeTransferId: null, attempts: 0 }).where(eq(schema.payouts.artistId, artistId));

    const refusal = new StripeLib.errors.StripeInvalidRequestError({ type: "invalid_request_error", message: "Insufficient funds", code: "balance_insufficient" } as never);
    vi.spyOn(stripe.transfers, "create").mockRejectedValueOnce(refusal);
    expect(await sendPendingPayouts()).toMatchObject({ paid: 0, failed: 0, deferred: 1 });
    expect((await listPayoutsForArtist(artistId))[0]).toMatchObject({ status: "pending", lastError: expect.stringContaining("Insufficient funds") });

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
    expect(await sendDuePostcards(schedule[0])).toMatchObject({ sent: 0, parked: 1 });

    const admin = await signInAdmin();
    const errors = await admin.agent.get("/api/admin/postcards/errors").expect(200);
    expect(errors.body[0]).toMatchObject({ id: postcardId, status: "error" });
    expect(errors.body[0].lastError).toContain("to[address_zip] is not a valid zip code");

    // The admin's view of the edition has every card of every collector.
    const detail = await admin.agent.get(`/api/admin/editions/${editionId}`).expect(200);
    expect(detail.body.postcards).toHaveLength(6);
    expect(detail.body.purchases).toEqual([expect.objectContaining({ id: purchaseId, stripePaymentIntentId: "pi_1" })]);

    await admin.agent.post(`/api/admin/postcards/${postcardId}/retry`).set("x-csrf-token", admin.csrf).expect(200);
    lobAnswer = () => new Response(JSON.stringify({ id: "psc_test_2", url: null, expected_delivery_date: null }), { status: 200, headers: { "content-type": "application/json" } });
    expect(await sendDuePostcards(schedule[0])).toMatchObject({ sent: 1 });
    // The ledger already had this card: no second share.
    const { listPayoutsForArtist } = await import("../db/payouts-repository.js");
    expect((await listPayoutsForArtist(artistId)).filter((p) => p.postcardId === postcardId)).toHaveLength(1);
  });
});

describe("the collector moves, then asks for their money back", () => {
  it("changes the default address without moving any collection", async () => {
    const fan = await signIn("fan@example.com");
    await fan.agent.put("/api/account/address").set("x-csrf-token", fan.csrf).send({ ...ADDRESS, line1: "9 New Road" }).expect(200);
    expect((await fan.agent.get("/api/account").expect(200)).body.customer.address.line1).toBe("9 New Road");

    const { listPostcardsForPurchase } = await import("../db/postcards-repository.js");
    expect((await listPostcardsForPurchase(purchaseId)).every((card) => card.recipient.line1 === "1 Test Street")).toBe(true);
    const { getPurchase } = await import("../db/purchases-repository.js");
    expect((await getPurchase(purchaseId))!.address.line1).toBe("1 Test Street");
  });

  it("sends one collection's cards still to come somewhere new, and leaves the sent one alone", async () => {
    const fan = await signIn("fan@example.com");
    const gift = { ...ADDRESS, name: "Aunt May", line1: "5 Gift Lane" };

    // Nobody else's collection: not found, not forbidden, so the id tells them nothing.
    const other = await signIn("artist@example.com");
    await other.agent.put(`/api/account/collections/${purchaseId}/address`).set("x-csrf-token", other.csrf).send(gift).expect(404);
    await fan.agent.put("/api/account/collections/nope/address").set("x-csrf-token", fan.csrf).send(gift).expect(404);

    await fan.agent.put(`/api/account/collections/${purchaseId}/address`).set("x-csrf-token", fan.csrf).send(gift).expect(200);
    const { listPostcardsForPurchase } = await import("../db/postcards-repository.js");
    const cards = await listPostcardsForPurchase(purchaseId);
    expect(cards[0]!.recipient.line1).toBe("1 Test Street");
    expect(cards.slice(1).every((card) => card.recipient.line1 === "5 Gift Lane")).toBe(true);
    // The account's default did not move with it.
    expect((await fan.agent.get("/api/account").expect(200)).body.customer.address.line1).toBe("9 New Road");
    const collections = await fan.agent.get("/api/account/collections").expect(200);
    expect(collections.body[0].address).toMatchObject({ name: "Aunt May", line1: "5 Gift Lane" });
  });

  it("keeps the cards coming after a partial refund, and withdraws the rest after a full one", async () => {
    const charge = { id: "ch_1", object: "charge", payment_intent: "pi_1", amount: 3000 };
    await webhook({ id: "evt_refund_partial", object: "event", type: "charge.refunded", data: { object: { ...charge, amount_refunded: 500 } } }).expect(200);
    const fan = await signIn("fan@example.com");
    let collections = await fan.agent.get("/api/account/collections").expect(200);
    expect(collections.body[0]).toMatchObject({ status: "paid", refundedCents: 500, nextMailDate: schedule[1] });

    await webhook({ id: "evt_refund_full", object: "event", type: "charge.refunded", data: { object: { ...charge, amount_refunded: 3000 } } }).expect(200);
    collections = await fan.agent.get("/api/account/collections").expect(200);
    expect(collections.body[0]).toMatchObject({ status: "refunded", refundedCents: 3000, sentCount: 1, nextMailDate: null });
    expect((collections.body[0].schedule as { status: string }[]).map((c) => c.status)).toEqual(["sent", "cancelled", "cancelled", "cancelled", "cancelled", "cancelled"]);

    // Nothing more goes, and nothing more is earned.
    const { sendDuePostcards } = await import("./fulfilment.js");
    expect(await sendDuePostcards(schedule[5])).toMatchObject({ sent: 0 });
    expect((await request(app).get("/api/artists/rachel").expect(200)).body.artist.collectorCount).toBe(0);

    // With nothing still to come, the edition can be collected again.
    await fan.agent.post("/api/checkout/collect").set("x-csrf-token", fan.csrf).send({ editionId, address: ADDRESS }).expect(200);
  });

  it("closes the edition to new collectors", async () => {
    const artist = await signIn("artist@example.com");
    const closed = await artist.agent.post(`/api/studio/editions/${editionId}/status`).set("x-csrf-token", artist.csrf).send({ status: "closed" }).expect(200);
    expect(closed.body.status).toBe("closed");

    const fan = await signIn("fan@example.com");
    const response = await fan.agent.post("/api/checkout/collect").set("x-csrf-token", fan.csrf).send({ editionId, address: ADDRESS });
    expect(response.status).toBe(409);
    // Its page still renders, for the people collecting it.
    await request(app).get("/api/artists/rachel/editions/birds").expect(200);
  });
});
