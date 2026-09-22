import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The same repository assertions against both dialects.
 *
 * The query layer is written once, and a divergence between the two schemas
 * shows up here as a zod parse failure or a wrong result. Postgres runs from
 * `embedded-postgres`; if those binaries are unavailable that half skips.
 */

interface Harness {
  databaseUrl: string;
  cleanup: () => Promise<void>;
}

function sqliteHarness(): Harness {
  const directory = mkdtempSync(path.join(tmpdir(), "yiwap-sqlite-"));
  return {
    databaseUrl: `file:${path.join(directory, "test.sqlite")}`,
    cleanup: () => {
      rmSync(directory, { recursive: true, force: true });
      return Promise.resolve();
    },
  };
}

async function postgresHarness(): Promise<Harness | null> {
  try {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const directory = mkdtempSync(path.join(tmpdir(), "yiwap-pg-"));
    const port = 54329;
    const pg = new EmbeddedPostgres({ databaseDir: path.join(directory, "data"), user: "yiwap", password: "yiwap", port, persistent: false });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("yiwap_test");
    return {
      databaseUrl: `postgres://yiwap:yiwap@localhost:${port}/yiwap_test`,
      cleanup: async () => {
        await pg.stop();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    console.warn("Skipping Postgres dialect tests:", (error as Error).message);
    return null;
  }
}

async function loadWith(databaseUrl: string) {
  process.env.DATABASE_URL = databaseUrl;
  vi.resetModules();

  const { runMigrations } = await import("./migrate.js");
  const { seedIfEmpty } = await import("./seed.js");
  const repository = await import("./repository.js");
  const admin = await import("./admin-repository.js");
  const artists = await import("./artists-repository.js");
  const designs = await import("./designs-repository.js");
  const subscriptions = await import("./subscriptions-repository.js");
  const mailings = await import("./mailings-repository.js");
  const postcards = await import("./postcards-repository.js");
  const orders = await import("./orders-repository.js");
  const payouts = await import("./payouts-repository.js");
  const pages = await import("./pages-repository.js");
  const customers = await import("./customers-repository.js");
  const auth = await import("../server/auth.js");
  const { getDatabase, resetDatabase } = await import("./client.js");

  await runMigrations();
  await seedIfEmpty();

  return { ...repository, admin, artists, designs, subscriptions, mailings, postcards, orders, payouts, pages, customers, auth, getDatabase, resetDatabase };
}

const ADDRESS = { name: "Grandma", line1: "1 Test Street", line2: null, city: "Marfa", state: "TX", postalCode: "79843", country: "US" };

const dialects = [
  { name: "sqlite", context: sqliteHarness() },
  { name: "postgres", context: await postgresHarness() },
];

for (const { name, context } of dialects) {
  describe.skipIf(context === null)(`repository on ${name}`, () => {
    let db: Awaited<ReturnType<typeof loadWith>>;

    beforeAll(async () => {
      db = await loadWith(context!.databaseUrl);
    }, 120_000);

    afterAll(async () => {
      await db?.resetDatabase();
      await context?.cleanup();
    });

    async function customer(name = "Someone") {
      const id = await db.auth.createCustomer(`${randomUUID()}@example.com`, "a-sufficiently-long-password", name);
      return id;
    }

    async function artist(slug = `artist-${randomUUID().slice(0, 8)}`) {
      const owner = await customer("Rachel");
      return db.artists.createArtist(owner, { slug, name: "Rachel", tagline: "photos from the road", bio: "# Hello", monthlyPriceCents: 500, sendDay: 15, visibility: "public", avatar: null, termMonths: 6, banner: null, links: [] });
    }

    async function design(artistId: string) {
      return db.designs.createDesign({
        artistId,
        orientation: "portrait",
        printPath: `designs/${randomUUID()}/print.png`,
        thumbnailPath: "designs/x/thumb.webp",
        thumbnailWidth: 400,
        thumbnailHeight: 588,
        back: { text: "Hi", valediction: "Love", fontName: "Sacramento", fontSize: 16, fontColor: "#112233" },
      });
    }

    async function activeSubscription(artistId: string, address = ADDRESS) {
      const who = await customer(address.name);
      const id = db.subscriptions.newSubscriptionId();
      await db.subscriptions.createIncompleteSubscription({ id, customerId: who, artistId, checkoutSessionId: `cs_${id}`, priceCents: 500, currency: "USD", termMonths: 6, address });
      await db.subscriptions.activateSubscription(id, { stripeSubscriptionId: `sub_${id}`, currentPeriodEnd: Date.now() + 30 * 86_400_000 });
      return (await db.subscriptions.getSubscription(id))!;
    }

    it("returns a schema-valid snapshot with the pricing", async () => {
      const store = await db.getStoreSnapshot();
      expect(store?.pricing).toEqual({ printCostCents: 120, platformFeeCents: 60, minMonthlyPriceCents: 300 });
      expect(store?.pages).toEqual([]);
    });

    it("round-trips settings, the hero, the pricing and the return address", async () => {
      const settings = (await db.getSettings())!;
      const returnAddress = { name: "Yes I Want A Postcard", line1: "185 Berry St", line2: null, city: "San Francisco", state: "CA", postalCode: "94107", country: "US" };
      await db.admin.updateSettings({
        ...settings,
        pricing: { printCostCents: 150, platformFeeCents: 75, minMonthlyPriceCents: 400 },
        returnAddress,
        hero: { heading: "Hello", text: null, buttonLabel: null, buttonHref: "/artists", image: null },
      });
      const updated = (await db.getSettings())!;
      expect(updated.pricing).toEqual({ printCostCents: 150, platformFeeCents: 75, minMonthlyPriceCents: 400 });
      expect(updated.returnAddress).toEqual(returnAddress);
      expect(updated.hero.heading).toBe("Hello");
      expect(updated.hero.buttonHref).toBe("/artists");

      await db.admin.updateSettings({ ...settings, returnAddress: null });
      expect((await db.getSettings())?.returnAddress).toBeNull();
    });

    it("creates an artist once per customer and refuses a taken slug", async () => {
      const a = await artist("first-artist");
      expect(a.status).toBe("draft");
      expect(a.payoutsEnabled).toBe(false);
      expect(await db.artists.findArtistBySlug("first-artist")).toMatchObject({ id: a.id });
      expect(await db.artists.slugIsTaken("first-artist")).toBe(true);
      expect(await db.artists.slugIsTaken("first-artist", a.id)).toBe(false);

      // The term, the banner and the links round-trip through both dialects' column types.
      expect(a).toMatchObject({ termMonths: 6, banner: null, links: [] });
      const banner = { path: "artists-x/banner.webp", width: 900, height: 300, alt: "", widths: [] };
      const links = [
        { label: "", url: "https://www.rachel.example/" },
        { label: "Instagram", url: "https://instagram.com/rachel" },
      ];
      const updated = await db.artists.updateArtistProfile(a.id, {
        slug: "first-artist",
        name: "Rachel",
        tagline: null,
        bio: "",
        monthlyPriceCents: 500,
        termMonths: 12,
        sendDay: 15,
        visibility: "public",
        avatar: null,
        banner,
        links,
      });
      expect(updated).toMatchObject({ termMonths: 12, banner, links });
      expect((await db.artists.findArtistBySlug("first-artist"))?.links).toEqual(links);

      await expect(artist("first-artist")).rejects.toThrow(/already in use/);

      await db.artists.setArtistStripeAccount(a.id, "acct_1", true);
      expect((await db.artists.findArtistByStripeAccount("acct_1"))?.payoutsEnabled).toBe(true);
      expect(await db.artists.setArtistStatus(a.id, "live")).toBe(true);
      expect((await db.artists.listArtists({ status: "live" })).artists.map((x) => x.id)).toContain(a.id);
    });

    it("round-trips a design's JSON back on either engine", async () => {
      const a = await artist();
      const created = await design(a.id);
      const found = await db.designs.getDesign(created.id);
      expect(found?.back).toEqual({ text: "Hi", valediction: "Love", fontName: "Sacramento", fontSize: 16, fontColor: "#112233" });
      expect(found?.orientation).toBe("portrait");
      expect(db.designs.toPublicDesign(found!).thumbnail.path).toBe("designs/x/thumb.webp");
      expect(await db.designs.getDesignForArtist(created.id, randomUUID())).toBeNull();
      expect(await db.designs.designIsUsed(created.id)).toBe(false);
    });

    it("keeps a subscription's address as JSON and only activates an incomplete one", async () => {
      const a = await artist();
      const who = await customer("Maya");
      const id = db.subscriptions.newSubscriptionId();
      await db.subscriptions.createIncompleteSubscription({ id, customerId: who, artistId: a.id, checkoutSessionId: `cs_${id}`, priceCents: 500, currency: "USD", termMonths: 6, address: ADDRESS });
      expect(await db.subscriptions.findOpenSubscription(who, a.id)).toBeNull();

      expect(await db.subscriptions.activateSubscription(id, { stripeSubscriptionId: "sub_a", currentPeriodEnd: 1_800_000_000_000 })).toBe(true);
      expect(await db.subscriptions.activateSubscription(id, { stripeSubscriptionId: "sub_b", currentPeriodEnd: null })).toBe(false);

      const found = (await db.subscriptions.findSubscriptionByStripeId("sub_a"))!;
      expect(found).toMatchObject({ id, status: "active", currentPeriodEnd: 1_800_000_000_000, cancelAtPeriodEnd: false, address: ADDRESS });
      expect(await db.subscriptions.findOpenSubscription(who, a.id)).toMatchObject({ id });

      await db.subscriptions.syncSubscription(id, { status: "past_due", currentPeriodEnd: null, cancelAtPeriodEnd: true });
      expect((await db.subscriptions.getSubscription(id))).toMatchObject({ status: "past_due", cancelAtPeriodEnd: true });

      const moved = { ...ADDRESS, line1: "9 New Road" };
      expect(await db.subscriptions.updateSubscriptionAddresses(who, moved)).toBe(1);
      expect((await db.subscriptions.getSubscription(id))?.address.line1).toBe("9 New Road");

      await db.subscriptions.syncSubscription(id, { status: "cancelled", currentPeriodEnd: null, cancelAtPeriodEnd: false });
      expect((await db.subscriptions.getSubscription(id))?.cancelledAt).toBeTypeOf("number");
      expect(await db.subscriptions.listActiveSubscriptionsForArtist(a.id)).toHaveLength(0);
    });

    it("queues one mailing a month, materialises a card per active subscriber, and sends it", async () => {
      const a = await artist();
      const d = await design(a.id);
      const grandma = await activeSubscription(a.id);
      const grandpa = await activeSubscription(a.id, { ...ADDRESS, name: "Grandpa" });
      // A paused-out subscriber gets nothing.
      const lapsed = await activeSubscription(a.id, { ...ADDRESS, name: "Lapsed" });
      await db.subscriptions.syncSubscription(lapsed.id, { status: "past_due", currentPeriodEnd: null, cancelAtPeriodEnd: false });

      const mailing = await db.mailings.createMailing({ artistId: a.id, designId: d.id, mailDate: "2026-10-15", title: "October", inGallery: true });
      expect(mailing.period).toBe("2026-10");
      await expect(db.mailings.createMailing({ artistId: a.id, designId: d.id, mailDate: "2026-10-20", title: null, inGallery: true })).rejects.toThrow(/already scheduled/);
      expect(await db.mailings.takenMailDates(a.id)).toEqual(["2026-10-15"]);
      expect(await db.designs.designIsUsed(d.id)).toBe(true);

      expect((await db.mailings.findDueMailings("2026-10-14", 10)).map((m) => m.id)).not.toContain(mailing.id);
      expect((await db.mailings.findDueMailings("2026-10-15", 10)).map((m) => m.id)).toContain(mailing.id);

      const active = await db.subscriptions.listActiveSubscriptionsForArtist(a.id);
      expect(active.map((s) => s.id).sort()).toEqual([grandma.id, grandpa.id].sort());
      expect(await db.postcards.materialisePostcards(mailing, active)).toBe(2);
      // Idempotent: a second sweep writes nothing new.
      expect(await db.postcards.materialisePostcards(mailing, active)).toBe(0);
      expect(await db.mailings.markMailingMailed(mailing.id, active.length)).toBe(true);
      expect(await db.mailings.markMailingMailed(mailing.id, active.length)).toBe(false);
      expect(await db.designs.designIsMailed(d.id)).toBe(true);

      const cards = await db.postcards.listPostcardsForMailing(mailing.id);
      expect(cards.map((c) => c.recipient.name)).toEqual(["Grandma", "Grandpa"]);
      expect(cards.every((c) => c.status === "scheduled" && c.mailDate === "2026-10-15")).toBe(true);

      const due = await db.postcards.findDuePostcards("2026-10-15", 50);
      const first = due.find((row) => row.mailingId === mailing.id)!;
      expect(await db.postcards.claimPostcard(first.id)).toBe(true);
      expect(await db.postcards.claimPostcard(first.id)).toBe(false);

      await db.postcards.markPostcardSent(first.id, { id: "psc_1", url: null, expectedDeliveryDate: "2026-10-20" });
      const sent = (await db.postcards.getPostcard(first.id))!;
      expect(sent.status).toBe("sent");
      expect(sent.sentAt).toBeTypeOf("number");

      const counts = (await db.mailings.countPostcardsByMailing([mailing.id])).get(mailing.id);
      expect(counts).toEqual({ scheduled: 1, sent: 1, error: 0, cancelled: 0 });
      expect((await db.artists.countForArtists([a.id])).get(a.id)).toEqual({ subscribers: 2, mailed: 1 });
      expect((await db.artists.latestMailedDesignIds([a.id])).get(a.id)).toBe(d.id);

      // The subscriber sees their card; the gallery shows the mailing.
      const received = await db.postcards.listPostcardsForCustomer(grandma.customerId);
      expect(received.map((c) => c.mailingId)).toEqual([mailing.id]);
      expect((await db.mailings.listGalleryMailings({ limit: 10 })).mailings.map((m) => m.id)).toContain(mailing.id);

      // A queued one can be withdrawn and the month reused; a mailed one cannot.
      expect(await db.mailings.cancelQueuedMailing(mailing.id, a.id)).toBe(false);
      const next = await db.mailings.createMailing({ artistId: a.id, designId: d.id, mailDate: "2026-11-15", title: null, inGallery: false });
      expect(await db.mailings.cancelQueuedMailing(next.id, randomUUID())).toBe(false);
      expect(await db.mailings.cancelQueuedMailing(next.id, a.id)).toBe(true);
      const again = await db.mailings.createMailing({ artistId: a.id, designId: d.id, mailDate: "2026-11-01", title: null, inGallery: false });
      expect(again.period).toBe("2026-11");
    });

    it("keeps tracking events per card and moves the status only forward, on either engine", async () => {
      const a = await artist();
      const d = await design(a.id);
      const sub = await activeSubscription(a.id);
      const mailing = await db.mailings.createMailing({ artistId: a.id, designId: d.id, mailDate: "2026-09-14", title: null, inGallery: true });
      await db.postcards.materialisePostcards(mailing, [sub]);
      const card = (await db.postcards.listPostcardsForMailing(mailing.id))[0]!;

      expect(await db.postcards.recordTrackingEvent(card.id, { id: `evt_${mailing.id}_2`, type: "postcard.delivered", occurredAt: Date.parse("2026-09-18T15:00:00Z"), location: null })).toBe(true);
      expect(await db.postcards.recordTrackingEvent(card.id, { id: `evt_${mailing.id}_1`, type: "postcard.in_transit", occurredAt: Date.parse("2026-09-15T10:00:00Z"), location: "MARFA TX" })).toBe(true);
      expect(await db.postcards.recordTrackingEvent(card.id, { id: `evt_${mailing.id}_1`, type: "postcard.in_transit", occurredAt: Date.parse("2026-09-15T10:00:00Z"), location: "MARFA TX" })).toBe(false);
      expect(await db.postcards.recordTrackingEvent(card.id, { id: `evt_${mailing.id}_3`, type: "postcard.rendered_pdf", occurredAt: Date.parse("2026-09-19T10:00:00Z"), location: null })).toBe(true);

      const tracked = (await db.postcards.getPostcard(card.id))!;
      expect(tracked.trackingStatus).toBe("postcard.delivered");
      expect(tracked.tracking).toEqual([
        { type: "postcard.in_transit", occurredAt: Date.parse("2026-09-15T10:00:00Z"), location: "MARFA TX" },
        { type: "postcard.delivered", occurredAt: Date.parse("2026-09-18T15:00:00Z"), location: null },
      ]);
      expect(await db.postcards.findPostcardForTracking(card.id, null)).toMatchObject({ id: card.id });
      expect(await db.postcards.findPostcardForTracking(null, "psc_nope")).toBeNull();

      // Withdraw, retry, cancel.
      expect(await db.postcards.cancelPostcard(card.id)).toBe(true);
      expect(await db.postcards.cancelPostcard(card.id)).toBe(false);
      expect(await db.postcards.requeuePostcard(card.id)).toBe(true);
      expect((await db.postcards.getPostcard(card.id))?.status).toBe("scheduled");
    });

    it("writes one ledger row per sent card, sums it, and pays it out once", async () => {
      const a = await artist();
      const d = await design(a.id);
      const sub = await activeSubscription(a.id);
      const mailing = await db.mailings.createMailing({ artistId: a.id, designId: d.id, mailDate: "2026-09-14", title: null, inGallery: true });
      await db.postcards.materialisePostcards(mailing, [sub]);
      const card = (await db.postcards.listPostcardsForMailing(mailing.id))[0]!;

      const earning = { artistId: a.id, postcardId: card.id, mailingId: mailing.id, grossCents: 500, printCostCents: 120, platformFeeCents: 60, amountCents: 320, currency: "USD" };
      expect(await db.payouts.recordEarning(earning)).toBe(true);
      expect(await db.payouts.recordEarning(earning)).toBe(false);
      expect(await db.payouts.sumEarningsForArtist(a.id)).toEqual({ pendingCents: 320, paidCents: 0 });

      // Not payable until the artist's account is.
      expect((await db.payouts.findPayablePayouts(10)).map((p) => p.artistId)).not.toContain(a.id);
      await db.artists.setArtistStripeAccount(a.id, `acct_${a.id}`, true);
      const [payable] = (await db.payouts.findPayablePayouts(10)).filter((p) => p.artistId === a.id);
      expect(payable).toMatchObject({ postcardId: card.id, amountCents: 320, status: "pending" });

      expect(await db.payouts.claimPayout(payable!.id)).toBe(true);
      expect(await db.payouts.claimPayout(payable!.id)).toBe(false);
      await db.payouts.markPayoutPaid(payable!.id, "tr_1");
      expect(await db.payouts.sumEarningsForArtist(a.id)).toEqual({ pendingCents: 0, paidCents: 320 });
      expect((await db.payouts.getPayout(payable!.id))).toMatchObject({ status: "paid", stripeTransferId: "tr_1", paidAt: expect.any(Number) });

      await db.payouts.markPayoutFailed(payable!.id, "no", "failed");
      expect(await db.payouts.requeuePayout(payable!.id)).toBe(true);
      expect((await db.payouts.getPayout(payable!.id))?.status).toBe("pending");
    });

    it("records a paid invoice once and a refund additively", async () => {
      const a = await artist();
      const sub = await activeSubscription(a.id);
      const input = { subscriptionId: sub.id, customerId: sub.customerId, artistId: a.id, stripeInvoiceId: `in_${sub.id}`, stripePaymentIntentId: `pi_${sub.id}`, amountCents: 500, currency: "USD", periodStart: 1_700_000_000_000, periodEnd: 1_702_600_000_000 };
      expect(await db.orders.recordPaidInvoice(input)).toBe(true);
      expect(await db.orders.recordPaidInvoice(input)).toBe(false);

      const order = (await db.orders.findOrderByPaymentIntent(`pi_${sub.id}`))!;
      expect(order).toMatchObject({ amountCents: 500, refundedCents: 0, status: "paid", periodStart: 1_700_000_000_000 });
      await db.orders.recordRefund(order.id, 200, false);
      await db.orders.recordRefund(order.id, 300, true);
      expect(await db.orders.findOrderByPaymentIntent(`pi_${sub.id}`)).toMatchObject({ refundedCents: 500, status: "refunded" });
      expect((await db.orders.listOrdersForCustomer(sub.customerId)).map((o) => o.id)).toEqual([order.id]);
      expect(await db.orders.sumRevenueCents()).toBeGreaterThanOrEqual(0);
    });

    it("keeps a customer's mailing address and Stripe customer", async () => {
      const who = await customer();
      expect(await db.customers.getMailingAddress(who)).toBeNull();
      await db.customers.setMailingAddress(who, ADDRESS);
      expect(await db.customers.getMailingAddress(who)).toEqual(ADDRESS);
      await db.customers.setStripeCustomerId(who, `cus_${who}`);
      expect(await db.customers.getStripeCustomerId(who)).toBe(`cus_${who}`);
      expect(await db.customers.findCustomerByStripeId(`cus_${who}`)).toMatchObject({ id: who });
    });

    it("round-trips a page's booleans", async () => {
      const id = await db.pages.createPage({ slug: "dialect-page", title: "Dialect Page", body: "# Hello", isLive: true, inNav: true });
      const page = await db.pages.findPageBySlug("dialect-page");
      expect(page?.id).toBe(id);
      expect(page?.isLive).toBe(true);
      expect(page?.inNav).toBe(true);
    });
  });
}
