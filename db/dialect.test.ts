import { randomUUID } from "node:crypto";
import { eq as eqFor } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The same repository assertions against both dialects.
 *
 * This is the test that makes "SQLite by default, Postgres when you outgrow
 * it" a claim rather than an aspiration: the query layer is written once, and
 * a divergence between the two schemas shows up here as a zod parse failure or
 * a wrong result, not on someone's production storefront.
 *
 * Postgres runs from `embedded-postgres`, so no system install is required.
 * If those binaries are unavailable the Postgres block skips rather than
 * failing the suite.
 */

interface Harness {
  databaseUrl: string;
  cleanup: () => Promise<void>;
}

function sqliteHarness(): Harness {
  const directory = mkdtempSync(path.join(tmpdir(), "beluga-sqlite-"));
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
    const directory = mkdtempSync(path.join(tmpdir(), "beluga-pg-"));
    // A high, unusual port so a developer's own Postgres is never touched.
    const port = 54329;

    const pg = new EmbeddedPostgres({
      databaseDir: path.join(directory, "data"),
      user: "beluga",
      password: "beluga",
      port,
      persistent: false,
    });

    await pg.initialise();
    await pg.start();
    await pg.createDatabase("beluga_test");

    return {
      databaseUrl: `postgres://beluga:beluga@localhost:${port}/beluga_test`,
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

/**
 * Load the data layer with a specific DATABASE_URL.
 *
 * `server/env.ts` snapshots process.env on first import, so the module graph
 * has to be reset between dialects.
 */
async function loadWith(databaseUrl: string) {
  process.env.DATABASE_URL = databaseUrl;
  vi.resetModules();

  const { runMigrations } = await import("./migrate.js");
  const { seedIfEmpty } = await import("./seed.js");
  const repository = await import("./repository.js");
  const admin = await import("./admin-repository.js");
  const orders = await import("./orders-repository.js");
  const pages = await import("./pages-repository.js");
  const webhooks = await import("./webhooks-repository.js");
  const { getDatabase, resetDatabase } = await import("./client.js");

  await runMigrations();
  await seedIfEmpty();

  return { ...repository, admin, orders, pages, webhooks, getDatabase, resetDatabase };
}

/**
 * Harnesses are resolved before collection, so `describe.skipIf` can make a
 * real decision — a `runIf` inside `beforeAll` would always see the initial
 * value and never skip.
 */
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

    async function stockOf(variantId: string): Promise<number> {
      const product = await db.findProductBySlug("canvas-tote");
      const variant = product?.variants.find((v) => v.id === variantId);
      return variant?.inventory.type === "finite" ? variant.inventory.quantity : -1;
    }

    it("round-trips a page's booleans on either engine", async () => {
      const id = await db.pages.createPage({
        slug: "dialect-page",
        title: "Dialect Page",
        body: "# Hello",
        isLive: true,
        inNav: true,
      });

      const page = await db.pages.findPageBySlug("dialect-page");

      // SQLite stores 0/1 and Postgres a real boolean; both must arrive as one.
      expect(page?.id).toBe(id);
      expect(page?.isLive).toBe(true);
      expect(page?.inNav).toBe(true);
      expect(page?.body).toBe("# Hello");

      // A draft is invisible to the storefront on both engines.
      await db.pages.updatePage(id, {
        slug: "dialect-page",
        title: "Dialect Page",
        body: "# Hello",
        isLive: false,
        inNav: true,
      });

      expect(await db.pages.findPageBySlug("dialect-page")).toBeNull();
      expect(await db.pages.findPageBySlug("dialect-page", false)).not.toBeNull();

      await db.pages.deletePage(id);
    });

    /*
     * The `aboutText` column is the whole reason this table exists, and a
     * migration that runs on every boot has to be able to run twice. The seed
     * writes an `aboutText` and no page, which is exactly the shape of an
     * install that predates pages.
     */
    it("adopts aboutText as a page exactly once", async () => {
      expect(await db.pages.adoptAboutTextAsPage()).toBe(true);
      expect(await db.pages.adoptAboutTextAsPage()).toBe(false);

      const summaries = await db.pages.listPageSummaries({ liveOnly: true });
      const about = summaries.filter((page) => page.slug === "about");

      expect(about).toHaveLength(1);
      expect(about[0]?.title).toBe("About");
      expect(about[0]?.inNav).toBe(true);

      // Paragraphs survive: the old column was newline-separated plain text,
      // and a single newline is a soft break in Markdown, not a new paragraph.
      const page = await db.pages.findPageBySlug("about");
      expect(page?.body).toContain("\n\n");
    });

    it("round-trips the hero columns on either engine", async () => {
      const settings = (await db.getSettings())!;

      await db.admin.updateSettings({
        ...settings,
        hero: {
          heading: "Small runs",
          text: "Made in batches of forty.",
          buttonLabel: "Browse",
          buttonHref: "/collection/home-goods",
          image: { path: "hero/one.png", width: 2400, height: 1200, alt: "", widths: [] },
        },
      });

      const updated = await db.getSettings();

      expect(updated?.hero).toMatchObject({
        heading: "Small runs",
        text: "Made in batches of forty.",
        buttonLabel: "Browse",
        buttonHref: "/collection/home-goods",
      });
      expect(updated?.hero.image).toMatchObject({ path: "hero/one.png", width: 2400 });

      // Cleared means null, not "": the reader falls back on null, and an
      // empty heading would render an empty <h1> on both engines alike.
      await db.admin.updateSettings({
        ...settings,
        hero: { heading: "", text: "  ", buttonLabel: null, buttonHref: null, image: null },
      });

      const cleared = await db.getSettings();
      expect(cleared?.hero).toEqual({
        heading: null,
        text: null,
        buttonLabel: null,
        buttonHref: null,
        image: null,
      });
    });

    it("round-trips a collection description on either engine", async () => {
      const collections = await db.admin.listCollectionDrafts();
      const first = collections[0]!;

      await db.admin.updateCollection(first.id, {
        slug: first.slug,
        name: first.name,
        cover: first.cover,
        description: "Things for the **table**.",
        productIds: first.productIds,
      });

      // The admin shape keeps the source; the storefront shape renders it.
      const drafts = await db.admin.listCollectionDrafts();
      expect(drafts.find((c) => c.id === first.id)?.description).toBe(
        "Things for the **table**.",
      );

      const shown = await db.listCollections();
      expect(shown.find((c) => c.id === first.id)?.descriptionHtml).toContain(
        "<strong>table</strong>",
      );
    });

    it("round-trips the tax settings on either engine", async () => {
      const settings = (await db.getSettings())!;

      await db.admin.updateSettings({
        name: settings.name,
        currency: settings.currency,
        stripePublishableKey: settings.stripePublishableKey,
        aboutText: settings.aboutText,
        taxEnabled: true,
        taxBehavior: "inclusive",
        defaultTaxCode: "txcd_20030000",
        cartRecoveryEnabled: settings.cartRecoveryEnabled,
        cartRecoveryDelayHours: settings.cartRecoveryDelayHours,
        hero: settings.hero,
        theme: settings.theme,
      });

      const updated = await db.getSettings();

      // taxEnabled is 0/1 on SQLite and a real boolean on Postgres.
      expect(updated?.taxEnabled).toBe(true);
      expect(updated?.taxBehavior).toBe("inclusive");
      expect(updated?.defaultTaxCode).toBe("txcd_20030000");

      await db.admin.updateSettings({
        name: settings.name,
        currency: settings.currency,
        stripePublishableKey: settings.stripePublishableKey,
        aboutText: settings.aboutText,
        taxEnabled: settings.taxEnabled,
        taxBehavior: settings.taxBehavior,
        defaultTaxCode: settings.defaultTaxCode,
        cartRecoveryEnabled: settings.cartRecoveryEnabled,
        cartRecoveryDelayHours: settings.cartRecoveryDelayHours,
        hero: settings.hero,
        theme: settings.theme,
      });
    });

    it("returns a schema-valid store snapshot", async () => {
      const store = await db.getStoreSnapshot();

      expect(store).not.toBeNull();
      expect(store?.name).toBe("Beluga Demo");
      // Only live products; the demo seeds four, all live.
      expect(store?.products.length).toBeGreaterThan(0);
    });

    it("round-trips JSON columns identically", async () => {
      const product = await db.findProductBySlug("canvas-tote");

      // bulletPoints is TEXT on SQLite and jsonb on Postgres.
      expect(product?.bulletPoints).toEqual([
        "16 oz cotton canvas",
        "38 × 40 × 12 cm",
        "Machine washable, cold",
      ]);
      expect(product?.optionGroups[0]?.choices).toEqual(["No", "Yes"]);
    });

    it("round-trips booleans identically", async () => {
      const rows = await db.admin.listAllProductsForAdmin();

      // SQLite stores 0/1; both must surface as real booleans.
      expect(rows.every((r) => typeof r.isLive === "boolean")).toBe(true);
    });

    it("keeps money as integer cents", async () => {
      const product = await db.findProductBySlug("canvas-tote");
      const prices = product?.variants.map((v) => v.priceCents) ?? [];

      expect(prices).toContain(3400);
      expect(prices.every((p) => Number.isInteger(p))).toBe(true);
    });

    it("preserves a collection's curated order", async () => {
      const page = await db.listProducts({ liveOnly: true, collectionSlug: "featured-products" });

      expect(page.products.map((p) => p.slug)).toEqual([
        "canvas-tote",
        "risograph-print",
        "enamel-mug",
      ]);
    });

    it("paginates consistently", async () => {
      const first = await db.listProducts({ liveOnly: true, limit: 2, offset: 0 });
      const second = await db.listProducts({ liveOnly: true, limit: 2, offset: 2 });

      expect(first.products).toHaveLength(2);
      expect(first.total).toBe(5);
      expect(second.products[0]?.slug).not.toBe(first.products[0]?.slug);
    });

    it("cascades variants and images on delete", async () => {

      const id = await db.admin.createProduct({
        slug: "cascade-test",
        name: "Cascade Test",
        kind: "physical",
        description: "",
        bulletPoints: [],
        seoTitle: null,
        seoDescription: null,
        taxCode: null,
        variants: [
          { label: "", priceCents: 100, inventory: { type: "infinite" }, weightGrams: 0, optionValues: [] },
        ],
        options: [],
        optionGroups: [],
        isLive: true,
      });

      expect(await db.findProductBySlug("cascade-test")).not.toBeNull();

      await db.admin.deleteProduct(id);
      expect(await db.findProductBySlug("cascade-test")).toBeNull();
    });

    it("round-trips a product's kind, and defaults it to physical", async () => {
      const id = await db.admin.createProduct({
        slug: "downloadable-thing",
        name: "Downloadable Thing",
        kind: "digital",
        description: "",
        bulletPoints: [],
        seoTitle: null,
        seoDescription: null,
        taxCode: null,
        variants: [
          { label: "", priceCents: 100, inventory: { type: "infinite" }, weightGrams: 0, optionValues: [] },
        ],
        options: [],
        optionGroups: [],
        isLive: true,
      });

      expect((await db.findProductBySlug("downloadable-thing"))?.kind).toBe("digital");

      // Both dialects default the column, so a row written before it existed
      // reads back physical rather than undefined.
      expect((await db.findProductBySlug("canvas-tote"))?.kind).toBe("physical");

      await db.admin.deleteProduct(id);
    });

    it("returns only the requested order's items", async () => {
      const product = (await db.findProductBySlug("canvas-tote"))!;
      const variant = product.variants[0]!;
      const line = (quantity: number) => ({
        productId: product.id,
        variantId: variant.id,
        productName: "Canvas Tote",
        variantLabel: variant.label,
        unitPriceCents: variant.priceCents,
        quantity,
        options: {},
      });

      const a = randomUUID();
      const b = randomUUID();
      await db.orders.createPendingOrder({
        id: a,
        checkoutSessionId: `cs_${a}`,
        email: "a@example.com",
        currency: "usd",
        subtotalCents: variant.priceCents,
        lines: [line(1)],
      });
      await db.orders.createPendingOrder({
        id: b,
        checkoutSessionId: `cs_${b}`,
        email: "b@example.com",
        currency: "usd",
        subtotalCents: variant.priceCents * 5,
        lines: [line(2), line(3)],
      });

      // The bug this guards: loadItems used to select the whole table, so
      // every order's detail page saw every other order's lines.
      const orderA = await db.orders.getOrder(a);
      expect(orderA?.items).toHaveLength(1);
      expect(orderA?.items.every((i) => i.quantity === 1)).toBe(true);

      expect((await db.orders.getOrder(b))?.items).toHaveLength(2);
    });

    it("returns an order's items in a stable order", async () => {
      const product = (await db.findProductBySlug("canvas-tote"))!;
      const variant = product.variants[0]!;

      const id = randomUUID();
      await db.orders.createPendingOrder({
        id,
        checkoutSessionId: `cs_${id}`,
        email: "stable@example.com",
        currency: "usd",
        subtotalCents: variant.priceCents * 6,
        lines: [1, 2, 3].map((quantity) => ({
          productId: product.id,
          variantId: variant.id,
          productName: "Canvas Tote",
          variantLabel: variant.label,
          unitPriceCents: variant.priceCents,
          quantity,
          options: {},
        })),
      });

      const first = await db.orders.getOrder(id);
      const second = await db.orders.getOrder(id);

      expect(first?.items).toHaveLength(3);
      expect(second?.items.map((i) => i.id)).toEqual(first?.items.map((i) => i.id));
    });

    it("loads items for more ids than the SQLite parameter limit", async () => {
      // 600 exceeds no limit on its own, but the chunking guard is what keeps
      // it under SQLite's 999 bound parameters as callers grow.
      const ids = Array.from({ length: 600 }, () => randomUUID());
      const items = await db.orders.loadItems(ids);

      expect(items.size).toBe(0);
    });

    it("restocks a refunded order exactly once", async () => {
      const product = (await db.findProductBySlug("canvas-tote"))!;
      const variant = product.variants.find((v) => v.inventory.type === "finite")!;
      const before = variant.inventory.type === "finite" ? variant.inventory.quantity : 0;

      const id = randomUUID();
      await db.orders.createPendingOrder({
        id,
        checkoutSessionId: `cs_${id}`,
        email: "restock@example.com",
        currency: "usd",
        subtotalCents: variant.priceCents * 2,
        lines: [
          {
            productId: product.id,
            variantId: variant.id,
            productName: product.name,
            variantLabel: variant.label,
            unitPriceCents: variant.priceCents,
            quantity: 2,
            options: {},
          },
        ],
      });

      await db.orders.decrementInventoryForOrder(id);
      expect(await stockOf(variant.id)).toBe(before - 2);

      expect(await db.orders.restockInventoryForOrder(id)).toBe(true);
      expect(await stockOf(variant.id)).toBe(before);

      // A refund can arrive as several webhooks; the second must be a no-op.
      expect(await db.orders.restockInventoryForOrder(id)).toBe(false);
      expect(await stockOf(variant.id)).toBe(before);
    });

    it("leaves infinite-inventory variants alone when restocking", async () => {
      const product = (await db.findProductBySlug("canvas-tote"))!;
      const infinite = product.variants.find((v) => v.inventory.type !== "finite");
      if (!infinite) return;

      const id = randomUUID();
      await db.orders.createPendingOrder({
        id,
        checkoutSessionId: `cs_${id}`,
        email: "infinite@example.com",
        currency: "usd",
        subtotalCents: infinite.priceCents,
        lines: [
          {
            productId: product.id,
            variantId: infinite.id,
            productName: product.name,
            variantLabel: infinite.label,
            unitPriceCents: infinite.priceCents,
            quantity: 1,
            options: {},
          },
        ],
      });

      expect(await db.orders.restockInventoryForOrder(id)).toBe(true);
    });

    it("restocks the remaining lines when a variant has been deleted", async () => {
      const product = (await db.findProductBySlug("canvas-tote"))!;
      const variant = product.variants.find((v) => v.inventory.type === "finite")!;
      const before = variant.inventory.type === "finite" ? variant.inventory.quantity : 0;

      const id = randomUUID();
      await db.orders.createPendingOrder({
        id,
        checkoutSessionId: `cs_${id}`,
        email: "gone@example.com",
        currency: "usd",
        subtotalCents: variant.priceCents * 2,
        lines: [
          {
            productId: product.id,
            variantId: variant.id,
            productName: product.name,
            variantLabel: variant.label,
            unitPriceCents: variant.priceCents,
            quantity: 1,
            options: {},
          },
          // The variant is gone, as it would be after the product was deleted.
          {
            productId: product.id,
            variantId: "deleted-variant",
            productName: "Deleted",
            variantLabel: "",
            unitPriceCents: variant.priceCents,
            quantity: 1,
            options: {},
          },
        ],
      });

      expect(await db.orders.restockInventoryForOrder(id)).toBe(true);
      expect(await stockOf(variant.id)).toBe(before + 1);
    });

    it("bounds a listing by date on either engine", async () => {
      const { drizzle: drizzleDb, schema, dialect } = await db.getDatabase();

      const id = randomUUID();
      await db.orders.createPendingOrder({
        id,
        checkoutSessionId: `cs_${id}`,
        email: "dated@example.com",
        currency: "usd",
        subtotalCents: 100,
        lines: [],
      });

      const placed = Date.UTC(2021, 5, 15);
      await drizzleDb
        .update(schema.orders)
        .set({ createdAt: dialect === "pg" ? new Date(placed) : Math.floor(placed / 1000) })
        .where(eqFor(schema.orders.id, id));

      // createdAt is unix seconds on one engine and a timestamptz on the other,
      // so a raw millisecond bound would match nothing on SQLite.
      const inside = await db.orders.listOrders({
        from: Date.UTC(2021, 0, 1),
        to: Date.UTC(2022, 0, 1),
      });
      expect(inside.orders.map((o) => o.id)).toContain(id);

      const after = await db.orders.listOrders({ from: Date.UTC(2023, 0, 1) });
      expect(after.orders.map((o) => o.id)).not.toContain(id);

      const before = await db.orders.listOrders({ to: Date.UTC(2020, 0, 1) });
      expect(before.orders.map((o) => o.id)).not.toContain(id);
    });

    it("rejects a duplicate slug", async () => {

      await expect(
        db.admin.createProduct({
          slug: "canvas-tote",
          name: "Clash",
          kind: "physical",
          description: "",
          bulletPoints: [],
          seoTitle: null,
          seoDescription: null,
          taxCode: null,
          variants: [
            { label: "", priceCents: 100, inventory: { type: "infinite" }, weightGrams: 0, optionValues: [] },
          ],
          options: [],
          optionGroups: [],
          isLive: true,
        }),
      ).rejects.toThrow(/already in use/i);
    });

    /*
     * The backfill turns v1-shaped data — a `variantName` and labelled
     * variants, no `product_options` row — into the options/values shape. It
     * runs on every boot, so it has to be a no-op the second time.
     */
    it("backfills a pre-migration product's variants into one option, exactly once", async () => {
      const { drizzle: drizzleDb, schema } = await db.getDatabase();

      const productId = randomUUID();
      await drizzleDb.insert(schema.products).values({
        id: productId,
        slug: "legacy-hat",
        name: "Legacy Hat",
        variantName: "size",
      });

      const smallId = randomUUID();
      const largeId = randomUUID();
      await drizzleDb.insert(schema.variants).values({
        id: smallId,
        productId,
        label: "Small",
        priceCents: 1000,
        position: 0,
      });
      await drizzleDb.insert(schema.variants).values({
        id: largeId,
        productId,
        label: "Large",
        priceCents: 1200,
        position: 1,
      });

      expect(await db.admin.backfillProductOptions()).toBeGreaterThan(0);
      expect(await db.admin.backfillProductOptions()).toBe(0);

      const product = await db.findProductBySlug("legacy-hat", false);
      expect(product?.options).toHaveLength(1);
      expect(product?.options[0]).toMatchObject({ name: "size", values: ["Small", "Large"] });

      const small = product?.variants.find((v) => v.id === smallId);
      const large = product?.variants.find((v) => v.id === largeId);
      expect(small?.optionValues).toEqual(["Small"]);
      expect(large?.optionValues).toEqual(["Large"]);
    });

    it("round-trips a webhook endpoint and its queued delivery", async () => {
      // The columns most likely to diverge: a JSON array and a JSON object,
      // which are TEXT on SQLite and jsonb on Postgres.
      const endpoint = await db.webhooks.createEndpoint({
        url: "https://example.com/hooks/dialect",
        description: "Dialect probe",
        eventTypes: ["order.paid", "inventory.low"],
        enabled: true,
        secret: "bwhsec_dialect",
      });

      expect(endpoint.eventTypes).toEqual(["order.paid", "inventory.low"]);
      expect(endpoint.enabled).toBe(true);

      const deliveryId = await db.webhooks.enqueueDelivery({
        endpointId: endpoint.id,
        eventId: "evt_dialect",
        eventType: "order.paid",
        payload: { id: "evt_dialect", type: "order.paid", data: { totalCents: 3400 } },
      });

      const [queued] = await db.webhooks.listDeliveries(endpoint.id, 10);
      expect(queued?.id).toBe(deliveryId);
      expect(queued?.payload).toEqual({
        id: "evt_dialect",
        type: "order.paid",
        data: { totalCents: 3400 },
      });

      // `next_attempt_at` defaults to now, and "due" is a timestamp comparison
      // against a unix integer on one engine and a timestamptz on the other.
      const due = await db.webhooks.findDueDeliveries(10);
      expect(due.map((row) => row.id)).toContain(deliveryId);

      // Only the first of two racing claims may win.
      expect(await db.webhooks.claimDelivery(deliveryId, 0, 60_000)).toBe(true);
      expect(await db.webhooks.claimDelivery(deliveryId, 0, 60_000)).toBe(false);

      // And the lease took it out of the due set.
      const stillDue = await db.webhooks.findDueDeliveries(10);
      expect(stillDue.map((row) => row.id)).not.toContain(deliveryId);

      await db.webhooks.markDelivered(deliveryId, 200);
      const [settled] = await db.webhooks.listDeliveries(endpoint.id, 10);
      expect(settled?.deliveredAt).not.toBeNull();
      expect(settled?.responseStatus).toBe(200);
    });

    it("disables a webhook endpoint only once the failure run reaches the cap", async () => {
      const endpoint = await db.webhooks.createEndpoint({
        url: "https://example.com/hooks/failing",
        description: "",
        eventTypes: ["order.paid"],
        enabled: true,
        secret: "bwhsec_failing",
      });

      // The increment is done in SQL rather than read-modify-write, so this is
      // the assertion that the expression compiles on both engines.
      expect(await db.webhooks.recordEndpointFailure(endpoint.id, "503", 3)).toBe(false);
      expect(await db.webhooks.recordEndpointFailure(endpoint.id, "503", 3)).toBe(false);
      expect(await db.webhooks.recordEndpointFailure(endpoint.id, "503", 3)).toBe(true);

      const disabled = await db.webhooks.findEndpoint(endpoint.id);
      expect(disabled?.enabled).toBe(false);
      expect(disabled?.consecutiveFailures).toBe(3);

      // Only the crossing reports true; a later failure is not a second event.
      expect(await db.webhooks.recordEndpointFailure(endpoint.id, "503", 3)).toBe(false);

      await db.webhooks.recordEndpointSuccess(endpoint.id);
      const healthy = await db.webhooks.findEndpoint(endpoint.id);
      expect(healthy?.consecutiveFailures).toBe(0);
      expect(healthy?.lastSuccessAt).not.toBeNull();
    });

    it("leaves a single unlabelled variant with no options", async () => {
      const { drizzle: drizzleDb, schema } = await db.getDatabase();

      const productId = randomUUID();
      await drizzleDb.insert(schema.products).values({
        id: productId,
        slug: "legacy-simple",
        name: "Legacy Simple",
      });

      await drizzleDb.insert(schema.variants).values({
        id: randomUUID(),
        productId,
        label: "",
        priceCents: 500,
        position: 0,
      });

      await db.admin.backfillProductOptions();

      const product = await db.findProductBySlug("legacy-simple", false);
      expect(product?.options).toEqual([]);
    });
  });
}
