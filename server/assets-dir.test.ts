import { mkdtempSync } from "node:fs";
import { access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import sharp from "sharp";

/**
 * ASSETS_DIR.
 *
 * A deployment points the upload directory at a mounted volume. What has to
 * stay true when it does: uploads land there and nowhere else, the storefront
 * serves them from the same place at the same URL, and the traversal guards —
 * which are prefix checks against the resolved root — still hold against the
 * new root. `server/env.ts` reads the environment on first import, so the
 * variable is set before any server module loads.
 */

const ASSETS_DIR = mkdtempSync(path.join(tmpdir(), "beluga-assets-"));
const PASSWORD = "a-sufficiently-long-test-password";

let app: Express;

beforeAll(async () => {
  process.env.ASSETS_DIR = ASSETS_DIR;

  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("assets@example.com", PASSWORD);
  app = createApp();
});

afterAll(async () => {
  delete process.env.ASSETS_DIR;
  await rm(ASSETS_DIR, { recursive: true, force: true });
});

async function signIn() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);
  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email: "assets@example.com", password: PASSWORD })
    .expect(200);
  return { agent, csrf: login.body.csrfToken as string };
}

function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

describe("ASSETS_DIR", () => {
  it("is what the upload code resolves its root to", async () => {
    const { ASSETS_ROOT } = await import("./uploads.js");
    expect(ASSETS_ROOT).toBe(path.resolve(ASSETS_DIR));
  });

  it("receives uploads, and serves them at the unchanged URL", async () => {
    const { agent, csrf } = await signIn();

    const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#123456" } })
      .png()
      .toBuffer();

    const uploaded = await agent
      .post("/api/admin/products/demo-tote/images")
      .set("x-csrf-token", csrf)
      .attach("file", png, { filename: "tote.png", contentType: "image/png" })
      .expect(201);

    const relativePath = uploaded.body.path as string;

    // On disk under the configured directory, not under public/assets.
    expect(await exists(path.join(ASSETS_DIR, relativePath))).toBe(true);
    expect(await exists(path.resolve("public/assets", relativePath))).toBe(false);

    // And the storefront's URL contract is unchanged.
    const served = await request(app).get(`/assets/${relativePath}`).expect(200);
    expect(served.headers["content-type"]).toMatch(/image\/webp/);

    await agent
      .delete("/api/admin/products/demo-tote/images")
      .set("x-csrf-token", csrf)
      .send({ path: relativePath })
      .expect(204);

    expect(await exists(path.join(ASSETS_DIR, relativePath))).toBe(false);
  });

  it("keeps the traversal guards anchored to the new root", async () => {
    const { deleteImageFile, storeImage } = await import("./uploads.js");

    await expect(deleteImageFile("../../etc/passwd")).rejects.toThrow(/invalid image path/i);
    await expect(storeImage("../escape", Buffer.alloc(0))).rejects.toThrow(/invalid upload target/i);

    // A stored path that resolves to the root itself is outside the tree too.
    await expect(deleteImageFile(".")).rejects.toThrow(/invalid image path/i);
  });
});
