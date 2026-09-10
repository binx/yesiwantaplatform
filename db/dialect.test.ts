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
  const directory = mkdtempSync(path.join(tmpdir(), "postcards-sqlite-"));
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
    const directory = mkdtempSync(path.join(tmpdir(), "postcards-pg-"));
    const port = 54329;
    const pg = new EmbeddedPostgres({ databaseDir: path.join(directory, "data"), user: "postcards", password: "postcards", port, persistent: false });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("postcards_test");
    return {
      databaseUrl: `postgres://postcards:postcards@localhost:${port}/postcards_test`,
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
  const orders = await import("./orders-repository.js");
  const designs = await import("./designs-repository.js");
  const pages = await import("./pages-repository.js");
  const carts = await import("./carts-repository.js");
  const customers = await import("./customers-repository.js");
  const { getDatabase, resetDatabase } = await import("./client.js");

  await runMigrations();
  await seedIfEmpty();

  return { ...repository, admin, orders, designs, pages, carts, customers, getDatabase, resetDatabase };
}

const RECIPIENT = { name: "Grandma", line1: "1 Test Street", line2: null, city: "Marfa", state: "TX", postalCode: "79843", country: "US" };

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

    async function design() {
      return db.designs.createDesign({
        customerId: null,
        orientation: "portrait",
        printPath: "designs/x/print.png",
        thumbnailPath: "designs/x/thumb.webp",
        thumbnailWidth: 400,
        thumbnailHeight: 588,
        back: { text: "Hi", valediction: "Love", fontName: "Sacramento", fontSize: 16, fontColor: "#112233" },
      });
    }

    it("returns a schema-valid store snapshot with the price", async () => {
      const store = await db.getStoreSnapshot();
      expect(store?.postcardPriceCents).toBe(140);
      expect(store?.pages).toEqual([]);
    });

    it("round-trips settings, the hero and the price", async () => {
      const settings = (await db.getSettings())!;
      await db.admin.updateSettings({
        ...settings,
        postcardPriceCents: 175,
        hero: { heading: "Hello", text: null, buttonLabel: null, buttonHref: "/create", image: null },
      });
      const updated = await db.getSettings();
      expect(updated?.postcardPriceCents).toBe(175);
      expect(updated?.hero.heading).toBe("Hello");
      expect(updated?.hero.buttonHref).toBe("/create");
    });

    it("round-trips a design's JSON back on either engine", async () => {
      const created = await design();
      const found = await db.designs.getDesign(created.id);
      expect(found?.back).toEqual({ text: "Hi", valediction: "Love", fontName: "Sacramento", fontSize: 16, fontColor: "#112233" });
      expect(found?.orientation).toBe("portrait");
      expect(db.designs.toPublicDesign(found!).thumbnail.path).toBe("designs/x/thumb.webp");
    });

    it("writes one postcard per design per recipient, and schedules them on payment", async () => {
      const a = await design();
      const b = await design();
      const orderId = randomUUID();
      await db.orders.createPendingOrder({
        id: orderId,
        checkoutSessionId: `cs_${orderId}`,
        email: "buyer@example.com",
        currency: "USD",
        unitPriceCents: 140,
        lines: [
          { designs: [{ designId: a.id, mailDate: "2026-10-01" }, { designId: b.id, mailDate: "2026-10-08" }], recipients: [RECIPIENT, { ...RECIPIENT, name: "Grandpa" }] },
          { designs: [{ designId: a.id, mailDate: "2026-11-01" }], recipients: [RECIPIENT] },
        ],
      });

      let order = (await db.orders.getOrder(orderId))!;
      expect(order.postcardCount).toBe(5);
      expect(order.subtotalCents).toBe(700);
      expect(order.postcards).toHaveLength(5);
      expect(order.designs.map((d) => d.id).sort()).toEqual([a.id, b.id].sort());
      expect(order.postcards.map((p) => p.batchIndex)).toEqual([0, 0, 0, 0, 1]);

      await db.orders.markOrderPaid(orderId, { paymentIntentId: "pi_1", email: "buyer@example.com", subtotalCents: 700, discountCents: 0, totalCents: 700, currency: "USD" });
      order = (await db.orders.getOrder(orderId))!;
      expect(order.status).toBe("paid");
      expect(order.postcards.every((p) => p.status === "scheduled")).toBe(true);

      // Due on the 8th: the first batch's two cards for design b only.
      const due = await db.orders.findDuePostcards("2026-10-08", 50);
      expect(due.filter((row) => row.orderId === orderId)).toHaveLength(4);
      expect(await db.orders.claimPostcard(due[0]!.id)).toBe(true);
      expect(await db.orders.claimPostcard(due[0]!.id)).toBe(false);

      await db.orders.markPostcardSent(due[0]!.id, { id: "psc_1", url: null, expectedDeliveryDate: "2026-10-14" });
      order = (await db.orders.getOrder(orderId))!;
      const sent = order.postcards.find((p) => p.id === due[0]!.id)!;
      expect(sent.status).toBe("sent");
      expect(sent.sentAt).toBeTypeOf("number");
      expect(await db.orders.completeOrderIfDone(orderId)).toBe(false);

      expect(await db.orders.cancelOrder(orderId)).toBe(4);
      order = (await db.orders.getOrder(orderId))!;
      expect(order.status).toBe("cancelled");
      expect(order.postcards.filter((p) => p.status === "cancelled")).toHaveLength(4);
    });

    it("records when a saved recipient was verified, and forgets it on edit", async () => {
      const { drizzle, schema } = await db.getDatabase();
      const customerId = randomUUID();
      await drizzle.insert(schema.customers).values({ id: customerId, email: `${customerId}@example.com`, passwordHash: null, name: null });

      const verified = await db.customers.createAddress(customerId, RECIPIENT, { verified: true });
      const plain = await db.customers.createAddress(customerId, { ...RECIPIENT, name: "Grandpa" });
      expect(typeof verified.verifiedAt).toBe("number");
      expect(plain.verifiedAt).toBeNull();

      const listed = await db.customers.listAddresses(customerId);
      expect(listed.find((a) => a.id === verified.id)?.verifiedAt).toBeTypeOf("number");
      expect(listed.find((a) => a.id === plain.id)?.verifiedAt).toBeNull();

      const edited = await db.customers.updateAddress(verified.id, customerId, { ...RECIPIENT, line1: "2 Test Street" });
      expect(edited.verifiedAt).toBeNull();
      expect((await db.customers.listAddresses(customerId)).find((a) => a.id === verified.id)?.verifiedAt).toBeNull();
    });

    it("round-trips the international price and the return address, on either engine", async () => {
      const settings = (await db.getSettings())!;
      const returnAddress = { name: "Postcard Gifts", line1: "185 Berry St", line2: null, city: "San Francisco", state: "CA", postalCode: "94107", country: "US" };
      await db.admin.updateSettings({ ...settings, internationalPostcardPriceCents: 250, returnAddress });
      const updated = (await db.getSettings())!;
      expect(updated.internationalPostcardPriceCents).toBe(250);
      expect(updated.returnAddress).toEqual(returnAddress);
      expect((await db.getStoreSnapshot())?.internationalPostcardPriceCents).toBe(250);

      await db.admin.updateSettings({ ...settings, internationalPostcardPriceCents: null, returnAddress: null });
      expect((await db.getSettings())?.returnAddress).toBeNull();
    });

    it("keeps a recipient's country on the postcard, and the second price on the order", async () => {
      const a = await design();
      const orderId = randomUUID();
      const abroad = { ...RECIPIENT, name: "Maya", state: "QC", postalCode: "H2X 1K4", country: "CA" };
      await db.orders.createPendingOrder({
        id: orderId,
        checkoutSessionId: `cs_${orderId}`,
        email: "buyer@example.com",
        currency: "USD",
        unitPriceCents: 140,
        internationalUnitPriceCents: 250,
        lines: [{ designs: [{ designId: a.id, mailDate: "2026-09-14" }], recipients: [RECIPIENT, abroad] }],
      });
      const order = (await db.orders.getOrder(orderId))!;
      expect(order.internationalCount).toBe(1);
      expect(order.internationalUnitPriceCents).toBe(250);
      expect(order.subtotalCents).toBe(390);
      expect(order.postcards.map((p) => p.recipient.country).sort()).toEqual(["CA", "US"]);
    });

    it("keeps tracking events per card and moves the status only forward, on either engine", async () => {
      const a = await design();
      const orderId = randomUUID();
      await db.orders.createPendingOrder({
        id: orderId,
        checkoutSessionId: `cs_${orderId}`,
        email: "buyer@example.com",
        currency: "USD",
        unitPriceCents: 140,
        lines: [{ designs: [{ designId: a.id, mailDate: "2026-09-14" }], recipients: [RECIPIENT] }],
      });
      const card = (await db.orders.getOrder(orderId))!.postcards[0]!;

      expect(await db.orders.recordTrackingEvent(card.id, { id: `evt_${orderId}_2`, type: "postcard.delivered", occurredAt: Date.parse("2026-09-18T15:00:00Z"), location: null })).toBe(true);
      expect(await db.orders.recordTrackingEvent(card.id, { id: `evt_${orderId}_1`, type: "postcard.in_transit", occurredAt: Date.parse("2026-09-15T10:00:00Z"), location: "MARFA TX" })).toBe(true);
      expect(await db.orders.recordTrackingEvent(card.id, { id: `evt_${orderId}_1`, type: "postcard.in_transit", occurredAt: Date.parse("2026-09-15T10:00:00Z"), location: "MARFA TX" })).toBe(false);
      expect(await db.orders.recordTrackingEvent(card.id, { id: `evt_${orderId}_3`, type: "postcard.rendered_pdf", occurredAt: Date.parse("2026-09-19T10:00:00Z"), location: null })).toBe(true);

      const tracked = (await db.orders.getOrder(orderId))!.postcards[0]!;
      expect(tracked.trackingStatus).toBe("postcard.delivered");
      expect(tracked.tracking).toEqual([
        { type: "postcard.in_transit", occurredAt: Date.parse("2026-09-15T10:00:00Z"), location: "MARFA TX" },
        { type: "postcard.delivered", occurredAt: Date.parse("2026-09-18T15:00:00Z"), location: null },
      ]);
      expect(await db.orders.findPostcardForTracking(card.id, null)).toMatchObject({ id: card.id });
      expect(await db.orders.findPostcardForTracking(null, "psc_nope")).toBeNull();
    });

    it("keeps the address book's label, tags, birthday and notes, on either engine", async () => {
      const { drizzle, schema } = await db.getDatabase();
      const customerId = randomUUID();
      await drizzle.insert(schema.customers).values({ id: customerId, email: `${customerId}@example.com`, passwordHash: null, name: null });

      const saved = await db.customers.createAddress(
        customerId,
        { ...RECIPIENT, label: "Mom", tags: ["family", "holiday"], birthday: "10-14", notes: "Likes the beach ones." },
        { source: "manual" },
      );
      const listed = (await db.customers.listAddresses(customerId)).find((a) => a.id === saved.id)!;
      expect(listed).toMatchObject({ label: "Mom", tags: ["family", "holiday"], birthday: "10-14", notes: "Likes the beach ones.", source: "manual", lastSentAt: null });
    });

    it("updates 'last sent' for a known address and keeps a namesake's new address beside the old", async () => {
      const { drizzle, schema } = await db.getDatabase();
      const customerId = randomUUID();
      await drizzle.insert(schema.customers).values({ id: customerId, email: `${customerId}@example.com`, passwordHash: null, name: null });
      const grandma = { ...RECIPIENT, label: null, tags: [], birthday: null, notes: null };

      expect(await db.customers.saveRecipientsFromOrder(customerId, [grandma])).toBe(1);
      const first = (await db.customers.listAddresses(customerId))[0]!;
      expect(first.source).toBe("order");
      expect(first.lastSentAt).toBeTypeOf("number");

      await db.customers.updateAddress(first.id, customerId, { ...grandma, label: "Grandma B" });
      expect(await db.customers.saveRecipientsFromOrder(customerId, [grandma])).toBe(0);
      const again = await db.customers.listAddresses(customerId);
      expect(again).toHaveLength(1);
      expect(again[0]?.label).toBe("Grandma B");

      // She moved: two entries, the label carried over, nothing guessed.
      expect(await db.customers.saveRecipientsFromOrder(customerId, [{ ...grandma, line1: "9 New Road" }])).toBe(1);
      const both = await db.customers.listAddresses(customerId);
      expect(both).toHaveLength(2);
      expect(both.every((a) => a.label === "Grandma B")).toBe(true);
    });

    it("round-trips a page's booleans", async () => {
      const id = await db.pages.createPage({ slug: "dialect-page", title: "Dialect Page", body: "# Hello", isLive: true, inNav: true });
      const page = await db.pages.findPageBySlug("dialect-page");
      expect(page?.id).toBe(id);
      expect(page?.isLive).toBe(true);
      expect(page?.inNav).toBe(true);
    });

    it("round-trips a cart's JSON lines", async () => {
      const { createCustomer } = await import("../server/auth.js");
      const customerId = await createCustomer(`cart-${randomUUID()}@example.com`, "a-sufficiently-long-password", null);
      const line = { designs: [{ designId: "d1", mailDate: "2026-10-01" }], recipients: [RECIPIENT] };
      const cart = await db.carts.upsertActiveCart(customerId, "x@example.com", "USD", [line]);
      expect(cart?.lines).toEqual([line]);
    });

    it("bounds a listing by date on either engine", async () => {
      const page = await db.orders.listOrders({ from: Date.now() - 60_000, to: Date.now() + 60_000, limit: 100 });
      expect(page.orders.length).toBeGreaterThan(0);
      const empty = await db.orders.listOrders({ from: Date.now() + 60_000 });
      expect(empty.orders).toHaveLength(0);
    });
  });
}
