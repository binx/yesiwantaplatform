import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Catalogue import and export, end to end.
 *
 * The headline assertion is the round trip: export the catalogue, import it
 * back unedited, and nothing may be created and nothing may change. It is the
 * only test that proves the two halves of the format actually agree, and it is
 * what a merchant does first when deciding whether to trust the importer.
 *
 * The other one that matters is negative: an import must never reach Stripe.
 * Invariant 7 — publishing is an explicit per-product action, and a file that
 * quietly published a hundred draft products would be unrecoverable.
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

async function signIn() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);

  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email: "catalogue@example.com", password: PASSWORD })
    .expect(200);

  return { agent, csrf: login.body.csrfToken as string };
}

type Agent = Awaited<ReturnType<typeof signIn>>;

/** Post a CSV body the way the import screen does. */
function send(
  { agent, csrf }: Agent,
  phase: "validate" | "commit",
  csv: string,
  query = "",
) {
  return agent
    .post(`/api/admin/products/import/${phase}${query}`)
    .set("x-csrf-token", csrf)
    .set("content-type", "text/csv")
    .send(csv);
}

async function exportCsv(agent: Agent) {
  const response = await agent.agent.get("/api/admin/products.csv").expect(200);
  return response.text;
}

/**
 * The catalogue, for comparing before against after.
 *
 * Option *ids* are excluded, and only those: `writeProductOptions` declares a
 * product's axes fresh on every save, so they are new rows after any write —
 * an autosave in the product editor rotates them too. Nothing durable
 * references them; a variant keeps its own id, which is the one that carries a
 * Stripe Price, and that is asserted separately below.
 */
async function snapshot() {
  const { listProducts } = await import("../db/repository.js");
  const page = await listProducts({ liveOnly: false, limit: 200 });

  return page.products
    .map((product) =>
      JSON.stringify({
        ...product,
        options: product.options.map(({ name, values }) => ({ name, values })),
      }),
    )
    .sort();
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("catalogue@example.com", PASSWORD);

  app = createApp();
});

describe("GET /api/admin/products.csv", () => {
  it("is served as a downloadable CSV with a BOM and the header row", async () => {
    const agent = await signIn();
    const response = await agent.agent.get("/api/admin/products.csv").expect(200);

    expect(response.headers["content-type"]).toMatch(/text\/csv; charset=utf-8/);
    expect(response.headers["content-disposition"]).toMatch(
      /attachment; filename="catalogue-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(response.text.startsWith("﻿")).toBe(true);
    expect(response.text.slice(1).split("\r\n")[0]).toBe(
      "slug,name,kind,description,bullet_points,seo_title,seo_description,tax_code," +
        "option1_name,option1_value,option2_name,option2_value,option3_name,option3_value," +
        "variant_sku,variant_price_cents,variant_compare_at_price_cents,variant_inventory_type," +
        "variant_inventory_quantity,variant_weight_grams,is_live,image_paths,variant_image_paths",
    );
  });

  it("writes one row per variant, including drafts", async () => {
    const agent = await signIn();
    const { listProducts } = await import("../db/repository.js");

    const page = await listProducts({ liveOnly: false, limit: 200 });
    const variants = page.products.reduce((total, p) => total + p.variants.length, 0);

    const body = await exportCsv(agent);
    // Header, every variant row, and the trailing CRLF's empty tail.
    expect(body.trimEnd().split("\r\n")).toHaveLength(variants + 1);
  });
});

describe("the round trip", () => {
  it("is a no-op: nothing created, and the catalogue is unchanged", async () => {
    const agent = await signIn();

    const before = await snapshot();
    const csv = await exportCsv(agent);

    const preview = await send(agent, "validate", csv).expect(200);
    expect(preview.body.errors).toEqual([]);
    expect(preview.body.creates).toBe(0);

    const committed = await send(agent, "commit", csv).expect(200);
    expect(committed.body.created).toBe(0);
    expect(committed.body.updated).toBe(preview.body.updates);

    expect(await snapshot()).toEqual(before);
  });

  it("keeps every variant id, so no Stripe Price is orphaned", async () => {
    const agent = await signIn();
    const { listProducts } = await import("../db/repository.js");

    const idsBefore = (await listProducts({ liveOnly: false, limit: 200 })).products
      .flatMap((product) => product.variants.map((variant) => variant.id))
      .sort();

    await send(agent, "commit", await exportCsv(agent)).expect(200);

    const idsAfter = (await listProducts({ liveOnly: false, limit: 200 })).products
      .flatMap((product) => product.variants.map((variant) => variant.id))
      .sort();

    expect(idsAfter).toEqual(idsBefore);
  });
});

describe("POST /api/admin/products/import/validate", () => {
  it("changes nothing, however valid the file is", async () => {
    const agent = await signIn();
    const before = await snapshot();

    const response = await send(
      agent,
      "validate",
      "slug,name,variant_price_cents\nvalidate-only,Validate Only,1000\n",
    ).expect(200);

    expect(response.body).toMatchObject({ rows: 1, creates: 1, updates: 0, errors: [] });
    expect(await snapshot()).toEqual(before);
  });

  it("reports three bad rows at once, each with its row and column", async () => {
    const agent = await signIn();

    const response = await send(
      agent,
      "validate",
      [
        "slug,name,variant_price_cents",
        "fine-one,Fine,1000",
        "bad-price,Bad price,19.99",
        "Bad Slug,Bad slug,1000",
        "bad-weight,Bad weight,oops",
      ].join("\n"),
    ).expect(200);

    const errors = response.body.errors as { row: number; column: string }[];

    expect(errors).toHaveLength(3);
    expect(errors.map((error) => [error.row, error.column])).toEqual([
      [3, "variant_price_cents"],
      [4, "slug"],
      [5, "variant_price_cents"],
    ]);
  });

  it("previews what each product would do", async () => {
    const agent = await signIn();

    const response = await send(
      agent,
      "validate",
      ["slug,name,variant_price_cents", "canvas-tote,Renamed Tote,1000", "brand-new,Brand New,1000"].join(
        "\n",
      ),
    ).expect(200);

    const products = response.body.products as { slug: string; action: string }[];
    const byAction = Object.fromEntries(products.map((p) => [p.slug, p.action]));
    expect(byAction["canvas-tote"]).toBe("update");
    expect(byAction["brand-new"]).toBe("create");
  });

  it("refuses a file with no header", async () => {
    const agent = await signIn();
    const response = await send(agent, "validate", "").expect(400);

    expect(response.body.error).toMatch(/empty/i);
  });

  it("refuses a file missing a column it cannot do without", async () => {
    const agent = await signIn();
    const response = await send(agent, "validate", "slug,name\ntote,Tote\n").expect(400);

    expect(response.body.error).toMatch(/variant_price_cents/);
  });
});

describe("POST /api/admin/products/import/commit", () => {
  it("creates a product, as a draft, and leaves Stripe alone", async () => {
    const agent = await signIn();
    const stripe = await import("./catalog-sync.js");
    const sync = vi.spyOn(stripe, "syncProductToStripe");

    await send(
      agent,
      "commit",
      [
        "slug,name,variant_price_cents,option1_name,option1_value,option2_name,option2_value",
        "imported-shirt,Imported Shirt,2000,Size,Small,Colour,Blue",
        "imported-shirt,Imported Shirt,2000,Size,Small,Colour,Red",
        "imported-shirt,Imported Shirt,2500,Size,Large,Colour,Blue",
      ].join("\n"),
    ).expect(200);

    const { findProductBySlug } = await import("../db/repository.js");
    const created = await findProductBySlug("imported-shirt", false);

    expect(created?.isLive).toBe(false);
    expect(created?.stripeProductId).toBeNull();
    expect(created?.variants).toHaveLength(3);
    expect(created?.options.map((option) => option.name)).toEqual(["Size", "Colour"]);
    expect(created?.variants.map((variant) => variant.label)).toEqual([
      "Small / Blue",
      "Small / Red",
      "Large / Blue",
    ]);
    expect(sync).not.toHaveBeenCalled();

    sync.mockRestore();
  });

  it("does not publish even a product the file marks live", async () => {
    const agent = await signIn();
    const stripe = await import("./catalog-sync.js");
    const sync = vi.spyOn(stripe, "syncProductToStripe");

    await send(
      agent,
      "commit",
      "slug,name,variant_price_cents,is_live\nimported-live,Imported Live,2000,true\n",
    ).expect(200);

    const { findProductBySlug } = await import("../db/repository.js");
    const created = await findProductBySlug("imported-live", false);

    // Live on the storefront, but still unpublished: reaching Stripe stays the
    // explicit per-product action.
    expect(created?.isLive).toBe(true);
    expect(created?.stripeProductId).toBeNull();
    expect(sync).not.toHaveBeenCalled();

    sync.mockRestore();
  });

  it("writes nothing at all when any row fails", async () => {
    const agent = await signIn();
    const before = await snapshot();

    const response = await send(
      agent,
      "commit",
      ["slug,name,variant_price_cents", "would-be-fine,Fine,1000", "bad-row,Bad,19.99"].join("\n"),
    ).expect(400);

    expect(response.body.error).toMatch(/nothing was imported/i);
    expect(await snapshot()).toEqual(before);
  });

  it("imports the rest only when the merchant asks to skip invalid rows", async () => {
    const agent = await signIn();

    const response = await send(
      agent,
      "commit",
      ["slug,name,variant_price_cents", "skip-survivor,Survivor,1000", "skip-casualty,Bad,19.99"].join(
        "\n",
      ),
      "?skipInvalid=true",
    ).expect(200);

    expect(response.body).toMatchObject({ created: 1, skipped: 1 });

    const { findProductBySlug } = await import("../db/repository.js");
    expect(await findProductBySlug("skip-survivor", false)).not.toBeNull();
    expect(await findProductBySlug("skip-casualty", false)).toBeNull();
  });

  it("updates an existing product without touching what the file omits", async () => {
    const agent = await signIn();
    const { findProductBySlug } = await import("../db/repository.js");

    const before = await findProductBySlug("canvas-tote", false);
    expect(before).not.toBeNull();

    // A price list: only the required columns, plus the options it already has.
    await send(
      agent,
      "commit",
      [
        "slug,name,variant_price_cents,option1_name,option1_value",
        `canvas-tote,${before!.name},4242,size,Small`,
        `canvas-tote,${before!.name},4900,size,Large`,
      ].join("\n"),
    ).expect(200);

    const after = await findProductBySlug("canvas-tote", false);
    expect(after?.variants.map((variant) => variant.priceCents)).toEqual([4242, 4900]);
    // Absent from the file, so not rewritten.
    expect(after?.description).toBe(before!.description);
    expect(after?.images).toEqual(before!.images);
    expect(after?.optionGroups).toEqual(before!.optionGroups);
    expect(after?.isLive).toBe(before!.isLive);
  });

  it("refuses to collapse a product's options by omitting their columns", async () => {
    const agent = await signIn();
    const { findProductBySlug } = await import("../db/repository.js");
    const before = await findProductBySlug("canvas-tote", false);

    // The dangerous accident: a price list from elsewhere, one row per product,
    // which taken literally would delete every variant but one.
    const response = await send(
      agent,
      "commit",
      `slug,name,variant_price_cents\ncanvas-tote,${before!.name},999\n`,
    ).expect(400);

    expect(response.body.error).toMatch(/nothing was imported/i);

    const after = await findProductBySlug("canvas-tote", false);
    expect(after?.variants).toHaveLength(before!.variants.length);
  });

  it("imports a 500-row file", async () => {
    const agent = await signIn();

    // Ten variants each across fifty products: the shape that would blow up a
    // per-row query or an in-memory copy of the whole file.
    const rows = ["slug,name,variant_price_cents,option1_name,option1_value"];
    for (let product = 0; product < 50; product += 1) {
      for (let variant = 0; variant < 10; variant += 1) {
        rows.push(`bulk-${product},Bulk ${product},${1000 + variant},Size,S${variant}`);
      }
    }

    const response = await send(agent, "commit", rows.join("\n")).expect(200);
    expect(response.body).toMatchObject({ created: 50, updated: 0 });

    const { findProductBySlug } = await import("../db/repository.js");
    expect((await findProductBySlug("bulk-49", false))?.variants).toHaveLength(10);
  }, 60_000);

  it("refuses a file with more rows than it will ever write", async () => {
    const agent = await signIn();

    const rows = ["slug,name,variant_price_cents"];
    for (let index = 0; index < 5_001; index += 1) {
      rows.push(`over-cap-${index},Over cap,1000`);
    }

    const response = await send(agent, "commit", rows.join("\n")).expect(413);
    expect(response.body.error).toMatch(/split it/i);
  }, 60_000);
});
