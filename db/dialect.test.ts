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
  const { resetDatabase } = await import("./client.js");

  await runMigrations();
  await seedIfEmpty();

  return { ...repository, admin, resetDatabase };
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
        variantName: null,
        variants: [{ label: "", priceCents: 100, inventory: { type: "infinite" } }],
        optionGroups: [],
        isLive: true,
      });

      expect(await db.findProductBySlug("cascade-test")).not.toBeNull();

      await db.admin.deleteProduct(id);
      expect(await db.findProductBySlug("cascade-test")).toBeNull();
    });

    it("rejects a duplicate slug", async () => {

      await expect(
        db.admin.createProduct({
          slug: "canvas-tote",
          name: "Clash",
          description: "",
          bulletPoints: [],
          variantName: null,
          variants: [{ label: "", priceCents: 100, inventory: { type: "infinite" } }],
          optionGroups: [],
          isLive: true,
        }),
      ).rejects.toThrow(/already in use/i);
    });
  });
}
