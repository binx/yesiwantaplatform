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
  const { getDatabase, resetDatabase } = await import("./client.js");

  await runMigrations();
  await seedIfEmpty();

  return { ...repository, admin, orders, pages, getDatabase, resetDatabase };
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
      expect(first.total).toBe(4);
      expect(second.products[0]?.slug).not.toBe(first.products[0]?.slug);
    });

    it("cascades variants and images on delete", async () => {

      const id = await db.admin.createProduct({
        slug: "cascade-test",
        name: "Cascade Test",
        description: "",
        bulletPoints: [],
        seoTitle: null,
        seoDescription: null,
        variantName: null,
        variants: [{ label: "", priceCents: 100, inventory: { type: "infinite" }, weightGrams: 0 }],
        optionGroups: [],
        isLive: true,
      });

      expect(await db.findProductBySlug("cascade-test")).not.toBeNull();

      await db.admin.deleteProduct(id);
      expect(await db.findProductBySlug("cascade-test")).toBeNull();
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
          description: "",
          bulletPoints: [],
          seoTitle: null,
          seoDescription: null,
          variantName: null,
          variants: [{ label: "", priceCents: 100, inventory: { type: "infinite" }, weightGrams: 0 }],
          optionGroups: [],
          isLive: true,
        }),
      ).rejects.toThrow(/already in use/i);
    });
  });
}
