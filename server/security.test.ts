import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import sharp from "sharp";

/**
 * The authorization model, asserted rather than spot-checked.
 *
 * Every route exercised here was reachable by an anonymous caller in v1: the
 * config, product and image endpoints had no session check at all, and `/user`
 * handed out admin to everyone whenever NODE_ENV was not "production".
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("admin@example.com", PASSWORD);

  app = createApp();
});

/** Log in and return an agent plus a valid CSRF token. */
async function signIn() {
  const agent = request.agent(app);

  const bootstrap = await agent.get("/api/session").expect(200);
  const initialToken = bootstrap.body.csrfToken as string;

  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", initialToken)
    .send({ email: "admin@example.com", password: PASSWORD })
    .expect(200);

  return { agent, csrf: login.body.csrfToken as string };
}

const MUTATIONS = [
  { method: "post", path: "/api/admin/products" },
  { method: "put", path: "/api/admin/products/demo-tote" },
  { method: "delete", path: "/api/admin/products/demo-tote" },
  { method: "post", path: "/api/admin/products/reorder" },
  { method: "post", path: "/api/admin/products/demo-tote/images" },
  { method: "delete", path: "/api/admin/products/demo-tote/images" },
  { method: "post", path: "/api/admin/collections" },
  { method: "put", path: "/api/admin/collections/demo-home" },
  { method: "delete", path: "/api/admin/collections/demo-home" },
  { method: "post", path: "/api/admin/pages" },
  { method: "post", path: "/api/admin/pages/preview" },
  { method: "post", path: "/api/admin/pages/reorder" },
  { method: "put", path: "/api/admin/pages/demo-page" },
  { method: "delete", path: "/api/admin/pages/demo-page" },
  { method: "put", path: "/api/admin/settings" },
  { method: "put", path: "/api/admin/shipping" },
  { method: "put", path: "/api/admin/orders/demo-order" },
  { method: "post", path: "/api/admin/orders/demo-order/refund" },
  { method: "post", path: "/api/admin/users" },
  { method: "delete", path: "/api/admin/users/someone" },
  { method: "delete", path: "/api/admin/users/invites/some-invite" },
  { method: "put", path: "/api/admin/users/me/password" },
] as const;

const READS = [
  "/api/admin/products",
  "/api/admin/collections",
  "/api/admin/pages",
  "/api/admin/settings",
  "/api/admin/shipping",
  "/api/admin/orders",
  "/api/admin/orders.csv",
  "/api/admin/users",
] as const;

describe("anonymous access", () => {
  it.each(MUTATIONS)("rejects $method $path with 401", async ({ method, path }) => {
    const response = await request(app)[method](path).send({});
    expect(response.status).toBe(401);
  });

  it.each(READS)("rejects GET %s with 401", async (path) => {
    await request(app).get(path).expect(401);
  });

  it("never reports an anonymous caller as admin", async () => {
    // v1 returned isAdmin: true here for everyone outside production.
    const response = await request(app).get("/api/session").expect(200);
    expect(response.body.isAdmin).toBe(false);
  });

  it("still serves the public storefront", async () => {
    const response = await request(app).get("/api/store").expect(200);
    expect(response.body.name).toBeTruthy();
  });

  it("serves the crawler files, which are deliberately public", async () => {
    await request(app).get("/sitemap.xml").expect(200);
    await request(app).get("/robots.txt").expect(200);
  });
});

describe("CSRF", () => {
  it("rejects an authenticated write with no token", async () => {
    const { agent } = await signIn();
    await agent.delete("/api/admin/products/demo-tote").expect(403);
  });

  it("rejects an authenticated write with the wrong token", async () => {
    const { agent } = await signIn();
    await agent
      .put("/api/admin/settings")
      .set("x-csrf-token", "not-the-right-token-at-all-padding-padding")
      .send({})
      .expect(403);
  });

  it("allows a write carrying the session's token", async () => {
    const { agent, csrf } = await signIn();
    await agent
      .put("/api/admin/settings")
      .set("x-csrf-token", csrf)
      .send({
        name: "Renamed",
        currency: "USD",
        stripePublishableKey: null,
        aboutText: null,
        theme: {
          colorPrimary: "#18181b",
          colorAccent: "#e07a5f",
          fontFamily: "system-ui",
          borderRadius: 2,
        },
      })
      .expect(204);
  });

  it("issues a fresh session on login, defeating fixation", async () => {
    const agent = request.agent(app);
    const before = await agent.get("/api/session").expect(200);

    const after = await agent
      .post("/api/session")
      .set("x-csrf-token", before.body.csrfToken)
      .send({ email: "admin@example.com", password: PASSWORD })
      .expect(200);

    expect(after.body.csrfToken).not.toBe(before.body.csrfToken);
  });
});

describe("login", () => {
  it("rejects a wrong password", async () => {
    const agent = request.agent(app);
    const { body } = await agent.get("/api/session").expect(200);

    await agent
      .post("/api/session")
      .set("x-csrf-token", body.csrfToken)
      .send({ email: "admin@example.com", password: "wrong" })
      .expect(401);
  });

  it("rejects an unknown account with the same status and message", async () => {
    const agent = request.agent(app);
    const { body } = await agent.get("/api/session").expect(200);

    const response = await agent
      .post("/api/session")
      .set("x-csrf-token", body.csrfToken)
      .send({ email: "nobody@example.com", password: "wrong" })
      .expect(401);

    // Must not disclose whether the account exists.
    expect(response.body.error).toBe("Incorrect email or password.");
  });
});

describe("uploads", () => {
  async function pngFixture() {
    return sharp({
      create: { width: 40, height: 30, channels: 3, background: "#cccccc" },
    })
      .png()
      .toBuffer();
  }

  it("rejects a non-image that claims an image content type", async () => {
    const { agent, csrf } = await signIn();

    await agent
      .post("/api/admin/products/demo-tote/images")
      .set("x-csrf-token", csrf)
      .attach("file", Buffer.from("#!/bin/sh\nrm -rf /\n"), {
        filename: "innocent.png",
        contentType: "image/png",
      })
      .expect(415);
  });

  it("discards a traversal filename instead of honouring it", async () => {
    const { agent, csrf } = await signIn();

    const response = await agent
      .post("/api/admin/products/demo-tote/images")
      .set("x-csrf-token", csrf)
      .attach("file", await pngFixture(), {
        filename: "../../../../tmp/pwned.png",
        contentType: "image/png",
      })
      .expect(201);

    // Stored under the product directory with a generated name.
    expect(response.body.path).toMatch(/^demo-tote\/[0-9a-f-]{36}\.webp$/);
    expect(response.body.path).not.toContain("..");

    // Clean up so repeat runs stay deterministic.
    await agent
      .delete("/api/admin/products/demo-tote/images")
      .set("x-csrf-token", csrf)
      .send({ path: response.body.path })
      .expect(204);
  });

  it("rejects an upload aimed at a product that does not exist", async () => {
    const { agent, csrf } = await signIn();

    await agent
      .post("/api/admin/products/..%2F..%2Ftmp/images")
      .set("x-csrf-token", csrf)
      .attach("file", await pngFixture(), { filename: "a.png", contentType: "image/png" })
      .expect(404);
  });
});

describe("input validation", () => {
  it("refuses a Stripe secret key in the publishable key field", async () => {
    const { agent, csrf } = await signIn();

    const response = await agent
      .put("/api/admin/settings")
      .set("x-csrf-token", csrf)
      .send({
        name: "Store",
        currency: "USD",
        stripePublishableKey: "sk_test_thisisasecretkey",
        aboutText: null,
        theme: {
          colorPrimary: "#000",
          colorAccent: "#000",
          fontFamily: "system-ui",
          borderRadius: 2,
        },
      })
      .expect(400);

    expect(response.body.error).toMatch(/secret key/i);
  });

  it("rejects a product with no variants, which would have no price", async () => {
    const { agent, csrf } = await signIn();

    await agent
      .post("/api/admin/products")
      .set("x-csrf-token", csrf)
      .send({ slug: "no-variants", name: "No Variants", variants: [] })
      .expect(400);
  });

  it("rejects a duplicate slug rather than silently shadowing", async () => {
    const { agent, csrf } = await signIn();

    const response = await agent
      .post("/api/admin/products")
      .set("x-csrf-token", csrf)
      .send({
        slug: "canvas-tote",
        name: "Duplicate",
        variants: [{ priceCents: 100, inventory: { type: "infinite" } }],
      })
      .expect(409);

    expect(response.body.error).toMatch(/already in use/i);
  });
});

describe("public API", () => {
  it("never exposes a draft product", async () => {
    const { agent, csrf } = await signIn();

    await agent
      .post("/api/admin/products")
      .set("x-csrf-token", csrf)
      .send({
        slug: "secret-draft",
        name: "Secret Draft",
        isLive: false,
        variants: [{ priceCents: 500, inventory: { type: "infinite" } }],
      })
      .expect(201);

    await request(app).get("/api/products/secret-draft").expect(404);

    const listing = await request(app).get("/api/products?limit=200").expect(200);
    const slugs = (listing.body.products as { slug: string }[]).map((p) => p.slug);
    expect(slugs).not.toContain("secret-draft");
  });

  it("caps the page size a caller can request", async () => {
    const response = await request(app).get("/api/products?limit=99999").expect(200);
    expect(response.body.limit).toBeLessThanOrEqual(200);
  });

  it("does not leak a secret key in the store payload", async () => {
    const response = await request(app).get("/api/store").expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(/sk_(test|live)_/);
  });
});
