import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import sharp from "sharp";

/**
 * A collection's cover image, end to end.
 *
 * `cover` was on the schema, filled by the seed and rendered at 16:9 on every
 * `/shop` tile — and there was no way to set one. Nothing in the admin touched
 * it and the update payload did not carry it, so a merchant who made a
 * collection got the "No image available" placeholder permanently.
 *
 * The round trip is the assertion that matters: upload, save, read it back
 * from the storefront's own snapshot. Each half passing on its own would not
 * have caught the original bug, which was a field dropped between them.
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";
const COLLECTION = "demo-home";

async function signIn() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);

  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email: "collections@example.com", password: PASSWORD })
    .expect(200);

  return { agent, csrf: login.body.csrfToken as string };
}

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#4477aa" } })
    .png()
    .toBuffer();
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("collections@example.com", PASSWORD);

  app = createApp();
});

// Uploads land in the real assets tree; take this collection's folder with us.
afterAll(async () => {
  const { ASSETS_ROOT } = await import("./uploads.js");
  await rm(path.join(ASSETS_ROOT, COLLECTION), { recursive: true, force: true });
});

describe("a collection's cover", () => {
  it("survives an upload, a save and a read back from the storefront", async () => {
    const { agent, csrf } = await signIn();

    const uploaded = await agent
      .post(`/api/admin/collections/${COLLECTION}/cover`)
      .set("x-csrf-token", csrf)
      .field("alt", "Home goods on a table")
      .attach("file", await png(1600, 900), "cover.png")
      .expect(201);

    expect(uploaded.body.path).toContain(`${COLLECTION}/`);

    const before = await agent.get("/api/admin/collections").expect(200);
    const collection = (
      before.body as { id: string; slug: string; name: string; productIds: string[] }[]
    ).find((row) => row.id === COLLECTION);
    expect(collection).toBeDefined();

    await agent
      .put(`/api/admin/collections/${COLLECTION}`)
      .set("x-csrf-token", csrf)
      .send({
        slug: collection?.slug,
        name: collection?.name,
        cover: { ...uploaded.body, alt: "Home goods on a table" },
        productIds: collection?.productIds,
      })
      .expect(204);

    // The storefront snapshot, not the admin list: this is what /shop renders.
    const store = await request(app).get("/api/store").expect(200);
    const shown = (store.body.collections as { id: string; cover: unknown }[]).find(
      (row) => row.id === COLLECTION,
    );

    expect(shown?.cover).toMatchObject({
      path: uploaded.body.path,
      width: uploaded.body.width,
      height: uploaded.body.height,
      alt: "Home goods on a table",
    });
  });

  it("clears the cover when one is saved as null", async () => {
    const { agent, csrf } = await signIn();

    const before = await agent.get("/api/admin/collections").expect(200);
    const collection = (
      before.body as { id: string; slug: string; name: string; productIds: string[] }[]
    ).find((row) => row.id === COLLECTION);

    await agent
      .put(`/api/admin/collections/${COLLECTION}`)
      .set("x-csrf-token", csrf)
      .send({
        slug: collection?.slug,
        name: collection?.name,
        cover: null,
        productIds: collection?.productIds,
      })
      .expect(204);

    const store = await request(app).get("/api/store").expect(200);
    const shown = (store.body.collections as { id: string; cover: unknown }[]).find(
      (row) => row.id === COLLECTION,
    );

    expect(shown?.cover).toBeNull();
  });

  /**
   * A collection's introduction, end to end.
   *
   * The same round trip the cover gets, and for the same reason: the admin
   * holds Markdown and the storefront receives HTML, so a field dropped
   * between them would pass either half on its own. The sanitiser assertion is
   * the load-bearing one — an administrator is a person a merchant invited
   * (task 07), and this text renders on the storefront for every shopper.
   */
  it("round-trips a description as Markdown, and serves it sanitised", async () => {
    const { agent, csrf } = await signIn();

    const before = await agent.get("/api/admin/collections").expect(200);
    const collection = (
      before.body as { id: string; slug: string; name: string; productIds: string[] }[]
    ).find((row) => row.id === COLLECTION);

    await agent
      .put(`/api/admin/collections/${COLLECTION}`)
      .set("x-csrf-token", csrf)
      .send({
        slug: collection?.slug,
        name: collection?.name,
        cover: null,
        description:
          "Things for the **table**.\n\n<script>alert(1)</script>\n\n[More](https://example.com)",
        productIds: collection?.productIds,
      })
      .expect(204);

    // The admin gets the source back, or the next save would store HTML.
    const after = await agent.get("/api/admin/collections").expect(200);
    const draft = (after.body as { id: string; description: string | null }[]).find(
      (row) => row.id === COLLECTION,
    );
    expect(draft?.description).toContain("**table**");
    expect(draft).not.toHaveProperty("descriptionHtml");

    // The storefront gets rendered, sanitised HTML — and no source.
    const store = await request(app).get("/api/store").expect(200);
    const shown = (store.body.collections as { id: string; descriptionHtml: string }[]).find(
      (row) => row.id === COLLECTION,
    );

    expect(shown?.descriptionHtml).toContain("<strong>table</strong>");
    expect(shown?.descriptionHtml).not.toContain("<script");
    // An outbound link is rewritten so it cannot carry an opener handle.
    expect(shown?.descriptionHtml).toContain('rel="nofollow noopener noreferrer"');
    expect(shown).not.toHaveProperty("description");
  });

  it("clears a description saved as null, rather than storing an empty one", async () => {
    const { agent, csrf } = await signIn();

    const before = await agent.get("/api/admin/collections").expect(200);
    const collection = (
      before.body as { id: string; slug: string; name: string; productIds: string[] }[]
    ).find((row) => row.id === COLLECTION);

    await agent
      .put(`/api/admin/collections/${COLLECTION}`)
      .set("x-csrf-token", csrf)
      .send({
        slug: collection?.slug,
        name: collection?.name,
        cover: null,
        description: null,
        productIds: collection?.productIds,
      })
      .expect(204);

    const store = await request(app).get("/api/store").expect(200);
    const shown = (store.body.collections as { id: string; descriptionHtml: string }[]).find(
      (row) => row.id === COLLECTION,
    );

    expect(shown?.descriptionHtml).toBe("");
  });

  /**
   * The hero, through the storefront's own snapshot.
   *
   * Caught by hand in a browser rather than by a test: `getSettings` grew a
   * `hero` and `getStoreSnapshot` did not pass it on, so every field arrived
   * null and the page rendered its fallbacks — which is exactly what a store
   * with no hero set is supposed to look like, so nothing failed. Component
   * tests hand `LandingPage` a store directly and never touch this seam.
   */
  it("carries the hero through /api/store, not just through getSettings", async () => {
    const { agent, csrf } = await signIn();

    const settings = await agent.get("/api/admin/settings").expect(200);

    await agent
      .put("/api/admin/settings")
      .set("x-csrf-token", csrf)
      .send({
        ...settings.body,
        hero: {
          heading: "Small runs",
          text: "Made in batches of forty.",
          buttonLabel: "Browse",
          buttonHref: "/collection/home-goods",
          image: null,
        },
      })
      .expect(204);

    const store = await request(app).get("/api/store").expect(200);

    expect(store.body.hero).toMatchObject({
      heading: "Small runs",
      text: "Made in batches of forty.",
      buttonLabel: "Browse",
      buttonHref: "/collection/home-goods",
    });
  });

  it("refuses a hero button pointing anywhere that is not a path or https", async () => {
    const { agent, csrf } = await signIn();

    const settings = await agent.get("/api/admin/settings").expect(200);

    for (const buttonHref of ["javascript:alert(1)", "//evil.example", "http://example.com"]) {
      await agent
        .put("/api/admin/settings")
        .set("x-csrf-token", csrf)
        .send({ ...settings.body, hero: { ...settings.body.hero, buttonHref } })
        .expect(400);
    }

    // And the store is unchanged by any of those attempts.
    const store = await request(app).get("/api/store").expect(200);
    expect(store.body.hero.buttonHref).not.toContain("evil.example");
  });

  it("refuses a cover upload for a collection that does not exist", async () => {
    const { agent, csrf } = await signIn();

    await agent
      .post("/api/admin/collections/not-a-collection/cover")
      .set("x-csrf-token", csrf)
      .attach("file", await png(400, 225), "cover.png")
      .expect(404);
  });
});
