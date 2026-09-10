import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import sharp from "sharp";

/**
 * The authorization model, asserted rather than spot-checked.
 *
 * Every admin route is behind `requireAdmin` + `verifyCsrf`, applied once to
 * the whole router; this file is what stops a new endpoint from shipping
 * outside it. A customer session must never reach an admin route, and an
 * admin session must never satisfy a customer one.
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin, createCustomer } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("admin@example.com", PASSWORD);
  await createCustomer("customer@example.com", PASSWORD, null);

  app = createApp();
});

async function signIn() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);
  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email: "admin@example.com", password: PASSWORD })
    .expect(200);
  return { agent, csrf: login.body.csrfToken as string };
}

async function signInCustomer() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);
  const login = await agent
    .post("/api/account/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email: "customer@example.com", password: PASSWORD })
    .expect(200);
  return { agent, csrf: login.body.csrfToken as string };
}

const MUTATIONS = [
  { method: "post", path: "/api/admin/pages" },
  { method: "post", path: "/api/admin/pages/preview" },
  { method: "post", path: "/api/admin/pages/reorder" },
  { method: "put", path: "/api/admin/pages/demo-page" },
  { method: "delete", path: "/api/admin/pages/demo-page" },
  { method: "put", path: "/api/admin/settings" },
  { method: "post", path: "/api/admin/settings/logo" },
  { method: "post", path: "/api/admin/settings/hero-image" },
  { method: "post", path: "/api/admin/email/test" },
  { method: "post", path: "/api/admin/lob/test" },
  { method: "post", path: "/api/admin/fulfilment/run" },
  { method: "post", path: "/api/admin/fulfilment/cleanup" },
  { method: "post", path: "/api/admin/orders/complimentary" },
  { method: "post", path: "/api/admin/orders/demo-order/cancel" },
  { method: "post", path: "/api/admin/orders/demo-order/refund" },
  { method: "post", path: "/api/admin/orders/demo-order/postcards/some-card/retry" },
  { method: "post", path: "/api/admin/orders/demo-order/postcards/some-card/cancel" },
  { method: "put", path: "/api/admin/users/me/password" },
] as const;

const READS = [
  "/api/admin/environment",
  "/api/admin/fulfilment",
  "/api/admin/pages",
  "/api/admin/settings",
  "/api/admin/orders",
  "/api/admin/orders.csv",
  "/api/admin/orders/demo-order",
] as const;

const CUSTOMER_MUTATIONS = [
  { method: "put", path: "/api/account" },
  { method: "post", path: "/api/account/addresses" },
  { method: "put", path: "/api/account/addresses/some-address" },
  { method: "delete", path: "/api/account/addresses/some-address" },
  { method: "post", path: "/api/account/designs/some-design/duplicate" },
  { method: "delete", path: "/api/account/designs/some-design" },
  { method: "post", path: "/api/account/address-requests" },
  { method: "post", path: "/api/account/address-requests/some-request/renew" },
  { method: "delete", path: "/api/account/address-requests/some-request" },
  { method: "put", path: "/api/account/reply-address" },
  { method: "delete", path: "/api/account/reply-address" },
  { method: "post", path: "/api/account/orders/some-order/postcards/some-card/reply/disable" },
  { method: "post", path: "/api/cart/sync" },
] as const;

const CUSTOMER_READS = [
  "/api/account/orders",
  "/api/account/orders/some-order",
  "/api/account/addresses",
  "/api/account/address-requests",
  "/api/account/designs",
  "/api/account/designs/some-design",
] as const;

const PUBLIC_CART_TOKEN_ROUTES = ["/api/cart/recover", "/api/cart/unsubscribe"] as const;
const PUBLIC_WRITE_ROUTES = ["/api/recipients/verify", "/api/address-requests/some-token", "/api/r/NOTACODE1/reaction"] as const;
const ADMIN_PASSWORD_RESET_ROUTES = ["/api/session/forgot-password", "/api/session/reset-password"] as const;

describe("anonymous access", () => {
  it.each(MUTATIONS)("rejects $method $path with 401", async ({ method, path }) => {
    const response = await request(app)[method](path).send({});
    expect(response.status).toBe(401);
  });

  it.each(READS)("rejects GET %s with 401", async (path) => {
    await request(app).get(path).expect(401);
  });

  it("never reports an anonymous caller as admin", async () => {
    const response = await request(app).get("/api/session").expect(200);
    expect(response.body.isAdmin).toBe(false);
  });

  it("still serves the public storefront", async () => {
    const response = await request(app).get("/api/store").expect(200);
    expect(response.body.name).toBeTruthy();
    expect(response.body.postcardPriceCents).toBe(140);
  });

  it("serves the crawler files", async () => {
    await request(app).get("/sitemap.xml").expect(200);
    await request(app).get("/robots.txt").expect(200);
  });
});

describe("Content-Security-Policy", () => {
  it("always sends upgrade-insecure-requests", async () => {
    const response = await request(app).get("/api/health").expect(200);
    expect(response.headers["content-security-policy"] ?? "").toContain("upgrade-insecure-requests");
  });
});

describe("CSRF", () => {
  it("rejects an authenticated write with no token", async () => {
    const { agent } = await signIn();
    await agent.delete("/api/admin/pages/demo-page").expect(403);
  });

  it("rejects an authenticated write with the wrong token", async () => {
    const { agent } = await signIn();
    await agent.put("/api/admin/settings").set("x-csrf-token", "not-the-right-token-at-all").send({}).expect(403);
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
        postcardPriceCents: 140,
        theme: { colorPrimary: "#18181b", colorAccent: "#e07a5f", fontFamily: "system-ui", borderRadius: 2 },
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
  it("rejects a wrong password and an unknown account identically", async () => {
    const a = request.agent(app);
    const { body } = await a.get("/api/session").expect(200);
    const wrong = await a
      .post("/api/session")
      .set("x-csrf-token", body.csrfToken)
      .send({ email: "admin@example.com", password: "wrong" })
      .expect(401);

    const b = request.agent(app);
    const second = await b.get("/api/session").expect(200);
    const unknown = await b
      .post("/api/session")
      .set("x-csrf-token", second.body.csrfToken)
      .send({ email: "nobody@example.com", password: "wrong" })
      .expect(401);

    expect(wrong.body.error).toBe(unknown.body.error);
  });
});

describe("customer session", () => {
  it.each(MUTATIONS)("rejects $method $path with 401", async ({ method, path }) => {
    const { agent, csrf } = await signInCustomer();
    const response = await agent[method](path).set("x-csrf-token", csrf).send({});
    expect(response.status).toBe(401);
  });

  it.each(READS)("rejects GET %s with 401", async (path) => {
    const { agent } = await signInCustomer();
    await agent.get(path).expect(401);
  });

  it("is never reported as admin", async () => {
    const { agent } = await signInCustomer();
    const response = await agent.get("/api/session").expect(200);
    expect(response.body.isAdmin).toBe(false);
  });
});

describe("customer routes", () => {
  async function anonymous() {
    const agent = request.agent(app);
    const { body } = await agent.get("/api/session").expect(200);
    return { agent, csrf: body.csrfToken as string };
  }

  it.each(CUSTOMER_MUTATIONS)("rejects an anonymous $method $path with 401", async ({ method, path }) => {
    const { agent, csrf } = await anonymous();
    const response = await agent[method](path).set("x-csrf-token", csrf).send({});
    expect(response.status).toBe(401);
  });

  it.each(CUSTOMER_READS)("rejects an anonymous GET %s with 401", async (path) => {
    await request(app).get(path).expect(401);
  });

  it.each(CUSTOMER_MUTATIONS)("rejects a tokenless $method $path with 403", async ({ method, path }) => {
    const response = await request(app)[method](path).send({});
    expect(response.status).toBe(403);
  });

  it.each(CUSTOMER_READS)("does not answer an admin session on GET %s", async (path) => {
    const { agent } = await signIn();
    await agent.get(path).expect(401);
  });

  it("answers the account probe to anyone, with nobody in it", async () => {
    const response = await request(app).get("/api/account").expect(200);
    expect(response.body).toEqual({ customer: null });
  });

  it("does not turn an admin session into a customer on the account probe", async () => {
    const { agent } = await signIn();
    const response = await agent.get("/api/account").expect(200);
    expect(response.body).toEqual({ customer: null });
  });

  it("refuses an unknown recovery token rather than returning a cart", async () => {
    const { agent, csrf } = await anonymous();
    const response = await agent.post("/api/cart/recover").set("x-csrf-token", csrf).send({ token: "not-a-real-token" });
    expect(response.status).toBe(410);
    expect(response.body.lines).toBeUndefined();
  });

  it("does not disclose whether an unsubscribe token existed", async () => {
    const { agent, csrf } = await anonymous();
    await agent.post("/api/cart/unsubscribe").set("x-csrf-token", csrf).send({ token: "not-a-real-token" }).expect(204);
  });

  it.each(PUBLIC_CART_TOKEN_ROUTES)("still requires a CSRF token on %s", async (path) => {
    await request(app).post(path).send({ token: "not-a-real-token" }).expect(403);
  });

  it.each(PUBLIC_WRITE_ROUTES)("still requires a CSRF token on %s", async (path) => {
    await request(app).post(path).send({}).expect(403);
  });
});

describe("Lob tracking webhook", () => {
  it("refuses an unsigned event", async () => {
    const response = await request(app).post("/api/webhooks/lob").set("content-type", "application/json").send("{}");
    // 503 with no secret configured, 400 with one; never accepted.
    expect([400, 503]).toContain(response.status);
  });
});

describe("admin password reset", () => {
  it.each(ADMIN_PASSWORD_RESET_ROUTES)("still requires a CSRF token on %s", async (path) => {
    await request(app).post(path).send({}).expect(403);
  });

  it("does not disclose whether the email belongs to an administrator", async () => {
    const known = request.agent(app);
    const k = await known.get("/api/session").expect(200);
    const knownResponse = await known
      .post("/api/session/forgot-password")
      .set("x-csrf-token", k.body.csrfToken)
      .send({ email: "admin@example.com" });

    const unknown = request.agent(app);
    const u = await unknown.get("/api/session").expect(200);
    const unknownResponse = await unknown
      .post("/api/session/forgot-password")
      .set("x-csrf-token", u.body.csrfToken)
      .send({ email: "no-such-admin@example.com" });

    expect(knownResponse.status).toBe(204);
    expect(unknownResponse.status).toBe(204);
    expect(knownResponse.body).toEqual(unknownResponse.body);
  });
});

describe("design uploads", () => {
  async function pngFixture() {
    return sharp({ create: { width: 40, height: 30, channels: 3, background: "#cccccc" } })
      .png()
      .toBuffer();
  }

  it("rejects a non-image that claims an image content type", async () => {
    await request(app)
      .post("/api/designs")
      .field("orientation", "portrait")
      .attach("file", Buffer.from("#!/bin/sh\nrm -rf /\n"), { filename: "innocent.png", contentType: "image/png" })
      .expect(415);
  });

  it("discards the filename and stores under a generated id", async () => {
    const response = await request(app)
      .post("/api/designs")
      .field("orientation", "landscape")
      .field("back", JSON.stringify({ text: "hi" }))
      .attach("file", await pngFixture(), { filename: "../../../../tmp/pwned.png", contentType: "image/png" })
      .expect(201);

    expect(response.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.thumbnail.path).toMatch(/^designs\/[0-9a-f-]{36}\/thumb\.webp$/);
    // Never the print path: a shopper is shown the thumbnail and nothing else.
    expect(JSON.stringify(response.body)).not.toContain("print.png");
  });

  it("refuses an unknown orientation", async () => {
    await request(app)
      .post("/api/designs")
      .field("orientation", "square")
      .attach("file", await pngFixture(), { filename: "a.png", contentType: "image/png" })
      .expect(400);
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
        postcardPriceCents: 140,
        theme: { colorPrimary: "#000", colorAccent: "#000", fontFamily: "system-ui", borderRadius: 2 },
      })
      .expect(400);
    expect(response.body.error).toMatch(/secret key/i);
  });

  it("refuses a postcard price below Stripe's floor", async () => {
    const { agent, csrf } = await signIn();
    const response = await agent
      .put("/api/admin/settings")
      .set("x-csrf-token", csrf)
      .send({
        name: "Store",
        currency: "USD",
        stripePublishableKey: null,
        postcardPriceCents: 10,
        theme: { colorPrimary: "#000", colorAccent: "#000", fontFamily: "system-ui", borderRadius: 2 },
      })
      .expect(400);
    expect(response.body.error).toMatch(/50 cents/i);
  });

  it("rejects a malformed reorder body with a 400, not a 500", async () => {
    const { agent, csrf } = await signIn();
    const response = await agent.post("/api/admin/pages/reorder").set("x-csrf-token", csrf).send({ ids: "nope" }).expect(400);
    expect(response.body.error).toBeTruthy();
  });
});

describe("public API", () => {
  it("does not leak a secret key in the store payload", async () => {
    const response = await request(app).get("/api/store").expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(/sk_(test|live)_/);
  });

  it("caps the number of designs one request may ask for", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`).join(",");
    await request(app).get(`/api/designs?ids=${ids}`).expect(400);
  });
});
