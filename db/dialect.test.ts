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
  const editions = await import("./editions-repository.js");
  const purchases = await import("./purchases-repository.js");
  const postcards = await import("./postcards-repository.js");
  const payouts = await import("./payouts-repository.js");
  const pages = await import("./pages-repository.js");
  const customers = await import("./customers-repository.js");
  const auth = await import("../server/auth.js");
  const { getDatabase, resetDatabase } = await import("./client.js");

  await runMigrations();
  await seedIfEmpty();

  return { ...repository, admin, artists, designs, editions, purchases, postcards, payouts, pages, customers, auth, getDatabase, resetDatabase };
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
      return db.artists.createArtist(owner, { slug, name: "Rachel", bio: "# Hello", visibility: "public", avatar: null, banner: { path: "artists-x/first.webp", width: 1200, height: 400, alt: "", widths: [] }, links: [] });
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

    /** A draft edition of six with every card in place, ready to go on sale. */
    async function edition(artistId: string, overrides: Partial<{ slug: string }> = {}) {
      const created = await db.editions.createEdition(artistId, {
        slug: overrides.slug ?? `set-${randomUUID().slice(0, 8)}`,
        title: "Birds",
        description: "",
        banner: null,
        cardCount: 6,
        priceCents: 3000,
        inGallery: true,
      });
      const designs = [];
      for (let i = 0; i < 6; i += 1) designs.push(await design(artistId));
      await db.editions.replaceEditionCards(created.id, designs.map((d) => ({ designId: d.id, title: null })));
      return { edition: created, designs, cards: await db.editions.listCardsForEdition(created.id) };
    }

    async function paidPurchase(set: Awaited<ReturnType<typeof edition>>, address = ADDRESS, startDate = "2026-11-01") {
      const who = await customer(address.name);
      const id = db.purchases.newPurchaseId();
      await db.purchases.createIncompletePurchase({
        id,
        customerId: who,
        editionId: set.edition.id,
        artistId: set.edition.artistId,
        checkoutSessionId: `cs_${id}`,
        priceCents: set.edition.priceCents,
        currency: "USD",
        cardCount: set.edition.cardCount,
        cadence: "monthly",
        startDate,
        address,
      });
      await db.purchases.markPurchasePaid(id, `pi_${id}`);
      const purchase = (await db.purchases.getPurchase(id))!;
      await db.postcards.materialisePostcards(purchase, set.cards);
      return purchase;
    }

    it("returns a schema-valid snapshot with the pricing", async () => {
      const store = await db.getStoreSnapshot();
      expect(store?.pricing).toEqual({ printCostCents: 120, platformFeePercent: 30, minCardPriceCents: 300 });
      expect(store?.pages).toEqual([]);
    });

    it("round-trips settings, the hero, the pricing and the return address", async () => {
      const settings = (await db.getSettings())!;
      const returnAddress = { name: "Yes I Want A Postcard", line1: "185 Berry St", line2: null, city: "San Francisco", state: "CA", postalCode: "94107", country: "US" };
      await db.admin.updateSettings({
        ...settings,
        pricing: { printCostCents: 150, platformFeePercent: 25, minCardPriceCents: 400 },
        returnAddress,
        hero: { heading: "Hello", text: null, buttonLabel: null, buttonHref: "/artists", image: null },
      });
      const updated = (await db.getSettings())!;
      expect(updated.pricing).toEqual({ printCostCents: 150, platformFeePercent: 25, minCardPriceCents: 400 });
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

      // The banner and the links round-trip through both dialects' column types.
      expect(a).toMatchObject({ banner: { path: "artists-x/first.webp", width: 1200, height: 400, alt: "", widths: [] }, links: [] });
      const banner = { path: "artists-x/banner.webp", width: 900, height: 300, alt: "", widths: [] };
      const links = [
        { kind: "website" as const, label: "", url: "https://www.rachel.example/" },
        { kind: "instagram" as const, label: "", url: "https://instagram.com/rachel" },
      ];
      const updated = await db.artists.updateArtistProfile(a.id, {
        name: "Rachel",
        bio: "",
        visibility: "public",
        avatar: null,
        banner,
        links,
      });
      expect(updated).toMatchObject({ banner, links });
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

    it("keeps a draft's cards in order, and fixes them once it is on sale", async () => {
      const a = await artist();
      const set = await edition(a.id, { slug: "birds" });
      expect(set.edition).toMatchObject({ status: "draft", cardCount: 6, inGallery: true });
      expect(set.cards.map((c) => c.position)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(set.cards.map((c) => c.designId)).toEqual(set.designs.map((d) => d.id));
      await expect(db.editions.createEdition(a.id, { slug: "birds", title: "Again", description: "", banner: null, cardCount: 6, priceCents: 3000, inGallery: true })).rejects.toThrow(/already have an edition/);
      expect(await db.designs.designIsUsed(set.designs[0]!.id)).toBe(true);
      expect(await db.designs.designIsLocked(set.designs[0]!.id)).toBe(false);

      // Reordered: the last first.
      const reordered = [set.designs[5]!, ...set.designs.slice(0, 5)];
      expect(await db.editions.replaceEditionCards(set.edition.id, reordered.map((d) => ({ designId: d.id, title: null })))).toBe(true);
      expect((await db.editions.listCardsForEdition(set.edition.id)).map((c) => c.designId)).toEqual(reordered.map((d) => d.id));

      expect(await db.editions.setEditionStatus(set.edition.id, ["draft"], "on_sale")).toBe(true);
      expect(await db.editions.setEditionStatus(set.edition.id, ["draft"], "on_sale")).toBe(false);
      expect(await db.designs.designIsLocked(set.designs[0]!.id)).toBe(true);
      // On sale: the cards and the numbers hold; the words still change.
      expect(await db.editions.replaceEditionCards(set.edition.id, [])).toBe(false);
      expect(await db.editions.updateDraftEdition(set.edition.id, a.id, { slug: "birds", title: "Birds", description: "", banner: null, cardCount: 12, priceCents: 1, inGallery: true })).toBe(false);
      const banner = { path: "artists-x/birds.webp", width: 900, height: 300, alt: "Birds on a wire", widths: [] };
      expect(await db.editions.updateEditionWords(set.edition.id, a.id, { title: "Birds of Marfa", description: "*Hi*", banner, inGallery: false })).toBe(true);
      expect(await db.editions.getEdition(set.edition.id)).toMatchObject({ title: "Birds of Marfa", priceCents: 3000, inGallery: false, banner });
      expect(await db.editions.deleteDraftEdition(set.edition.id, a.id)).toBe(false);
      expect((await db.editions.listEditionsForArtist(a.id, ["on_sale"])).map((e) => e.id)).toEqual([set.edition.id]);
      expect(await db.editions.findEditionBySlug(a.id, "birds")).toMatchObject({ id: set.edition.id });

      // A draft shrunk to fewer cards drops the extra ones.
      const other = await edition(a.id);
      await db.editions.updateDraftEdition(other.edition.id, a.id, { slug: other.edition.slug, title: "Fewer", description: "", banner: null, cardCount: 6, priceCents: 2400, inGallery: true });
      expect(await db.editions.getEdition(other.edition.id)).toMatchObject({ title: "Fewer", priceCents: 2400 });
      expect(await db.editions.deleteDraftEdition(other.edition.id, randomUUID())).toBe(false);
      expect(await db.editions.deleteDraftEdition(other.edition.id, a.id)).toBe(true);
    });

    it("sends an edition through review, and the admin alone puts it on sale, on either engine", async () => {
      const a = await artist();
      expect(a).toMatchObject({ reviewStatus: "pending", reviewNote: null, reviewedAt: null });
      expect((await db.artists.listArtists({ reviewStatus: "pending" })).artists.map((row) => row.id)).toContain(a.id);
      // Asking again is for a declined page only.
      expect(await db.artists.requestArtistReview(a.id)).toBe(false);
      expect(await db.artists.reviewArtist(a.id, { decision: "declined", note: "Not yet." })).toBe(true);
      expect(await db.artists.getArtist(a.id)).toMatchObject({ reviewStatus: "declined", reviewNote: "Not yet." });
      expect(await db.artists.requestArtistReview(a.id)).toBe(true);
      expect(await db.artists.requestArtistReview(a.id)).toBe(false);
      expect(await db.artists.reviewArtist(a.id, { decision: "approved", note: "" })).toBe(true);
      const approved = await db.artists.getArtist(a.id);
      expect(approved).toMatchObject({ reviewStatus: "approved", reviewNote: null });
      expect(approved?.reviewedAt).toBeTypeOf("number");
      expect((await db.artists.listArtists({ reviewStatus: "pending" })).artists.map((row) => row.id)).not.toContain(a.id);

      const set = await edition(a.id);
      expect(set.edition).toMatchObject({ status: "draft", reviewNote: null, submittedAt: null, reviewedAt: null });
      // Nothing to decide on a draft.
      expect(await db.editions.reviewEdition(set.edition.id, { decision: "approved", note: "" })).toBe(false);
      expect(await db.editions.submitEditionForReview(set.edition.id, randomUUID())).toBe(false);
      expect(await db.editions.submitEditionForReview(set.edition.id, a.id)).toBe(true);
      expect(await db.editions.submitEditionForReview(set.edition.id, a.id)).toBe(false);
      const inReview = await db.editions.getEdition(set.edition.id);
      expect(inReview?.status).toBe("in_review");
      expect(inReview?.submittedAt).toBeTypeOf("number");
      // Fixed while the admin looks, like one on sale.
      expect(await db.editions.replaceEditionCards(set.edition.id, [])).toBe(false);
      expect(await db.editions.updateDraftEdition(set.edition.id, a.id, { slug: set.edition.slug, title: "Nope", description: "", banner: null, cardCount: 6, priceCents: 3000, inGallery: true })).toBe(false);
      expect(await db.editions.deleteDraftEdition(set.edition.id, a.id)).toBe(false);
      // The artist can take it back, then send it again.
      expect(await db.editions.setEditionStatus(set.edition.id, ["in_review"], "draft")).toBe(true);
      expect(await db.editions.submitEditionForReview(set.edition.id, a.id)).toBe(true);

      expect(await db.editions.reviewEdition(set.edition.id, { decision: "declined", note: "Card 3 is blurry." })).toBe(true);
      expect(await db.editions.getEdition(set.edition.id)).toMatchObject({ status: "draft", reviewNote: "Card 3 is blurry." });
      expect(await db.editions.submitEditionForReview(set.edition.id, a.id)).toBe(true);
      expect(await db.editions.getEdition(set.edition.id)).toMatchObject({ status: "in_review", reviewNote: null });
      expect(await db.editions.reviewEdition(set.edition.id, { decision: "approved", note: "" })).toBe(true);
      expect(await db.editions.reviewEdition(set.edition.id, { decision: "declined", note: "" })).toBe(false);
      expect(await db.editions.getEdition(set.edition.id)).toMatchObject({ status: "on_sale", reviewNote: null });
      expect((await db.editions.listEditions({ status: "in_review" })).total).toBe(0);
      expect(await db.editions.countEditionsByStatus()).toMatchObject({ on_sale: expect.any(Number) });
    });

    it("pays a purchase once, writes every card of its run on its day, and moves the cards still to come", async () => {
      const a = await artist();
      const set = await edition(a.id);
      const who = await customer("Maya");
      const id = db.purchases.newPurchaseId();
      await db.purchases.createIncompletePurchase({ id, customerId: who, editionId: set.edition.id, artistId: a.id, checkoutSessionId: `cs_${id}`, priceCents: 3000, currency: "USD", cardCount: 6, cadence: "twice_monthly", startDate: "2026-11-05", address: ADDRESS });
      expect(await db.purchases.findPurchaseByCheckoutSession(`cs_${id}`)).toMatchObject({ id, status: "incomplete", address: ADDRESS });
      expect(await db.purchases.editionHasPurchases(set.edition.id)).toBe(true);

      expect(await db.purchases.markPurchasePaid(id, "pi_a")).toBe(true);
      expect(await db.purchases.markPurchasePaid(id, "pi_b")).toBe(false);
      const purchase = (await db.purchases.findPurchaseByPaymentIntent("pi_a"))!;
      expect(purchase).toMatchObject({ id, status: "paid", startDate: "2026-11-05", paidAt: expect.any(Number) });

      expect(await db.postcards.materialisePostcards(purchase, set.cards)).toBe(6);
      // Idempotent: a redelivered webhook writes nothing new.
      expect(await db.postcards.materialisePostcards(purchase, set.cards)).toBe(0);
      const run = await db.postcards.listPostcardsForPurchase(id);
      expect(run.map((c) => c.mailDate)).toEqual(["2026-11-05", "2026-11-19", "2026-12-05", "2026-12-19", "2027-01-05", "2027-01-19"]);
      expect(run.map((c) => c.position)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(await db.purchases.findRunningPurchase(who, set.edition.id)).toMatchObject({ id });
      expect((await db.purchases.countCollectorsForEditions([set.edition.id])).get(set.edition.id)).toBe(1);

      // One set sent somewhere else: the collector's own paid purchase only.
      const gift = { ...ADDRESS, name: "Aunt May", line1: "5 Gift Lane" };
      expect(await db.purchases.updatePurchaseAddress(id, "someone-else", gift)).toBe(false);
      expect(await db.purchases.updatePurchaseAddress(id, who, gift)).toBe(true);
      expect((await db.purchases.getPurchase(id))!.address).toMatchObject({ name: "Aunt May", line1: "5 Gift Lane" });
      // Its cards still to come follow; one already mailed does not.
      await db.postcards.markPostcardSent(run[0]!.id, { id: "psc_first", url: null, expectedDeliveryDate: null });
      expect(await db.postcards.updateUnsentPostcardAddresses([id], gift)).toBe(5);
      const after = await db.postcards.listPostcardsForPurchase(id);
      expect(after[0]!.recipient.line1).toBe("1 Test Street");
      expect(after[1]!.recipient.line1).toBe("5 Gift Lane");

      const schedule = (await db.postcards.listSchedules([id])).get(id)!;
      expect(schedule[0]).toEqual({ position: 1, mailDate: "2026-11-05", status: "sent" });
      expect((await db.postcards.countPostcardsByEdition([set.edition.id])).get(set.edition.id)).toEqual({ sent: 1, scheduled: 5 });

      // A full refund cancels the rest.
      await db.purchases.recordPurchaseRefund(id, 3000, true);
      expect(await db.postcards.cancelUnsentPostcards(id)).toBe(5);
      expect(await db.purchases.getPurchase(id)).toMatchObject({ status: "refunded", refundedCents: 3000 });
      expect(await db.purchases.findRunningPurchase(who, set.edition.id)).toBeNull();
      expect((await db.purchases.listPurchasesForCustomer(who)).map((p) => p.id)).toEqual([id]);
      expect(await db.purchases.sumRevenueCents()).toBeGreaterThanOrEqual(0);

      // An abandoned checkout is tidied away, and only that.
      const abandoned = db.purchases.newPurchaseId();
      await db.purchases.createIncompletePurchase({ id: abandoned, customerId: who, editionId: set.edition.id, artistId: a.id, checkoutSessionId: `cs_${abandoned}`, priceCents: 3000, currency: "USD", cardCount: 6, cadence: "monthly", startDate: "2026-11-01", address: ADDRESS });
      expect(await db.purchases.deleteIncompletePurchase(abandoned)).toBe(true);
      expect(await db.purchases.deleteIncompletePurchase(id)).toBe(false);
    });

    it("sends what is due, and the first copy of each card marks it mailed", async () => {

      const a = await artist();
      const set = await edition(a.id);
      const grandma = await paidPurchase(set, ADDRESS, "2026-10-15");
      await paidPurchase(set, { ...ADDRESS, name: "Grandpa" }, "2026-10-20");

      const dueOn15 = (await db.postcards.findDuePostcards("2026-10-15", 50)).filter((row) => row.editionId === set.edition.id);
      expect(dueOn15.map((row) => row.recipientName)).toEqual(["Grandma"]);
      const first = dueOn15[0]!;
      expect(await db.postcards.claimPostcard(first.id)).toBe(true);
      expect(await db.postcards.claimPostcard(first.id)).toBe(false);

      await db.postcards.markPostcardSent(first.id, { id: "psc_1", url: null, expectedDeliveryDate: "2026-10-20" });
      await db.editions.markEditionCardMailed(first.editionCardId);
      const sent = (await db.postcards.getPostcard(first.id))!;
      expect(sent).toMatchObject({ status: "sent", position: 1, purchaseId: grandma.id });
      expect(sent.sentAt).toBeTypeOf("number");

      expect((await db.artists.countForArtists([a.id])).get(a.id)).toEqual({ collectors: 2, mailed: 1 });



      // The collector sees the card that went, and only that one.
      const received = await db.postcards.listPostcardsForCustomer(grandma.customerId);
      expect(received.map((c) => c.id)).toEqual([first.id]);
      expect((await db.postcards.listPostcardsForEdition(set.edition.id)).length).toBe(12);
    });

    it("keeps tracking events per card and moves the status only forward, on either engine", async () => {
      const a = await artist();
      const purchase = await paidPurchase(await edition(a.id));
      const card = (await db.postcards.listPostcardsForPurchase(purchase.id))[0]!;
      const mailing = { id: card.id };

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
      const purchase = await paidPurchase(await edition(a.id));
      const card = (await db.postcards.listPostcardsForPurchase(purchase.id))[0]!;

      const earning = { artistId: a.id, postcardId: card.id, purchaseId: purchase.id, grossCents: 500, printCostCents: 120, platformFeeCents: 60, amountCents: 320, currency: "USD" };
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
