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

  it("refuses a cover upload for a collection that does not exist", async () => {
    const { agent, csrf } = await signIn();

    await agent
      .post("/api/admin/collections/not-a-collection/cover")
      .set("x-csrf-token", csrf)
      .attach("file", await png(400, 225), "cover.png")
      .expect(404);
  });
});
