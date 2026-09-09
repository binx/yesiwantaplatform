import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  const { createAdmin, createCustomer } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("admin@example.com", PASSWORD);
  await createCustomer("customer@example.com", PASSWORD, null);

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

/** Log in as the storefront customer, not an administrator. */
async function signInCustomer() {
  const agent = request.agent(app);

  const bootstrap = await agent.get("/api/session").expect(200);
  const initialToken = bootstrap.body.csrfToken as string;

  const login = await agent
    .post("/api/account/session")
    .set("x-csrf-token", initialToken)
    .send({ email: "customer@example.com", password: PASSWORD })
    .expect(200);

  return { agent, csrf: login.body.csrfToken as string };
}

const MUTATIONS = [
  { method: "post", path: "/api/admin/products" },
  { method: "put", path: "/api/admin/products/demo-tote" },
  { method: "delete", path: "/api/admin/products/demo-tote" },
  { method: "post", path: "/api/admin/products/reorder" },
  { method: "post", path: "/api/admin/products/import/validate" },
  { method: "post", path: "/api/admin/products/import/commit" },
  { method: "post", path: "/api/admin/products/demo-tote/images" },
  { method: "delete", path: "/api/admin/products/demo-tote/images" },
  { method: "post", path: "/api/admin/collections" },
  { method: "put", path: "/api/admin/collections/demo-home" },
  { method: "post", path: "/api/admin/collections/demo-home/cover" },
  { method: "delete", path: "/api/admin/collections/demo-home" },
  { method: "post", path: "/api/admin/pages" },
  { method: "post", path: "/api/admin/pages/preview" },
  { method: "post", path: "/api/admin/pages/reorder" },
  { method: "put", path: "/api/admin/pages/demo-page" },
  { method: "delete", path: "/api/admin/pages/demo-page" },
  { method: "put", path: "/api/admin/settings" },
  // Both image uploads. `settings/logo` predates this list and was never in
  // it — an unprotected upload endpoint is exactly what this file exists to
  // stop shipping, so it is added here alongside the new one.
  { method: "post", path: "/api/admin/settings/logo" },
  { method: "post", path: "/api/admin/settings/hero-image" },
  { method: "post", path: "/api/admin/email/test" },
  { method: "put", path: "/api/admin/shipping" },
  { method: "put", path: "/api/admin/orders/demo-order" },
  { method: "post", path: "/api/admin/orders/demo-order/refund" },
  { method: "post", path: "/api/admin/users" },
  { method: "delete", path: "/api/admin/users/someone" },
  { method: "delete", path: "/api/admin/users/invites/some-invite" },
  { method: "put", path: "/api/admin/users/me/password" },
  { method: "post", path: "/api/admin/webhooks" },
  { method: "put", path: "/api/admin/webhooks/some-endpoint" },
  { method: "delete", path: "/api/admin/webhooks/some-endpoint" },
  { method: "post", path: "/api/admin/webhooks/some-endpoint/secret" },
  { method: "post", path: "/api/admin/webhooks/deliveries/some-delivery/redeliver" },
  { method: "put", path: "/api/admin/storefront" },
  { method: "put", path: "/api/admin/storefront/password" },
  { method: "delete", path: "/api/admin/storefront/password" },
  { method: "post", path: "/api/admin/storefront/share-link" },
  { method: "delete", path: "/api/admin/storefront/share-link" },
] as const;

const READS = [
  "/api/admin/products",
  "/api/admin/products.csv",
  "/api/admin/collections",
  "/api/admin/pages",
  "/api/admin/settings",
  "/api/admin/shipping",
  "/api/admin/orders",
  "/api/admin/orders.csv",
  "/api/admin/users",
  "/api/admin/webhooks",
  "/api/admin/webhooks/some-endpoint/deliveries",
  "/api/admin/storefront",
] as const;

/**
 * The storefront's own authenticated surface, behind `requireCustomer`.
 *
 * A second pair of arrays rather than more entries in `MUTATIONS`/`READS`,
 * because the two registries assert opposite things about a customer session:
 * these routes must *answer* a signed-in customer and refuse everyone else,
 * where the admin arrays must refuse the customer too.
 */
const CUSTOMER_MUTATIONS = [
  { method: "put", path: "/api/account" },
  { method: "post", path: "/api/account/addresses" },
  { method: "put", path: "/api/account/addresses/some-address" },
  { method: "delete", path: "/api/account/addresses/some-address" },
  { method: "post", path: "/api/cart/sync" },
] as const;

/*
 * `GET /api/account` is deliberately absent.
 *
 * It is the probe every storefront page makes on first paint, so it answers
 * 200 to anyone — "nobody is signed in" is the ordinary state of a visitor,
 * not a refusal, and 401-ing it painted a red error in the console of every
 * page load. What has to stay true is that it hands out no customer to anyone
 * who is not that customer, which is asserted explicitly below rather than by
 * membership here. `PUT /api/account` is a write and stays in
 * CUSTOMER_MUTATIONS.
 */
const CUSTOMER_READS = [
  "/api/account/orders",
  "/api/account/orders/some-order",
  "/api/account/addresses",
] as const;

/**
 * Deliberately anonymous, and listed here so their absence from the arrays
 * above reads as a decision rather than an oversight: both are reached from a
 * link in an email, where there is no session to require. The unguessable
 * token in the body is the credential, and each is asserted below to reject
 * one that does not match.
 */
const PUBLIC_CART_TOKEN_ROUTES = ["/api/cart/recover", "/api/cart/unsubscribe"] as const;

/**
 * Deliberately anonymous, for the same reason as the cart token routes above:
 * an administrator who has lost their password cannot sign in to request a
 * reset. Listed here rather than in MUTATIONS so their absence from that
 * array reads as a decision, and asserted below to still enforce CSRF.
 */
const ADMIN_PASSWORD_RESET_ROUTES = [
  "/api/session/forgot-password",
  "/api/session/reset-password",
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

/**
 * Task 29, group 3: `upgradeInsecureRequests` was written as if it were
 * production-only, but helmet merges its own defaults in regardless of what
 * is passed, so the header was identical in every environment — the
 * conditional never did anything. Asserted explicitly here so the next merge
 * of helmet's defaults cannot make that drift silently again.
 */
describe("Content-Security-Policy", () => {
  it("always sends upgrade-insecure-requests, not only in production", async () => {
    const response = await request(app).get("/api/health").expect(200);
    const csp = response.headers["content-security-policy"] ?? "";

    expect(csp).toContain("upgrade-insecure-requests");
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

describe("customer session", () => {
  // The single most important assertion in this file's customer-accounts
  // addition: a storefront login must never grant admin, on any route.
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
  /** An agent with a valid CSRF token but no session behind it. */
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

  // The CSRF check is router-wide and runs first, so a tokenless write never
  // reaches `requireCustomer` at all — 403 before 401.
  it.each(CUSTOMER_MUTATIONS)("rejects a tokenless $method $path with 403", async ({ method, path }) => {
    const response = await request(app)[method](path).send({});
    expect(response.status).toBe(403);
  });

  // The mirror of the customer-is-never-admin block: `requireCustomer` reads
  // `customerId`, which an administrator's session does not carry.
  it.each(CUSTOMER_READS)("does not answer an admin session on GET %s", async (path) => {
    const { agent } = await signIn();
    await agent.get(path).expect(401);
  });

  /*
   * The probe, held to the property that actually matters.
   *
   * It is public, so the assertion is on the body, not the status: no session
   * that is not a customer's may come back carrying a customer. An admin
   * session is the sharp case — `requireCustomer` reads `customerId`, which an
   * administrator's session does not carry, and this handler reads the same
   * field rather than trusting that any session will do.
   */
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
    const response = await agent
      .post("/api/cart/recover")
      .set("x-csrf-token", csrf)
      .send({ token: "not-a-real-token" });

    expect(response.status).toBe(410);
    expect(response.body.lines).toBeUndefined();
  });

  // Unsubscribe answers 204 whether or not the token matched, on purpose: the
  // link lands in an inbox, and a distinguishable response would turn it into
  // an oracle for which tokens are live.
  it("does not disclose whether an unsubscribe token existed", async () => {
    const { agent, csrf } = await anonymous();
    await agent
      .post("/api/cart/unsubscribe")
      .set("x-csrf-token", csrf)
      .send({ token: "not-a-real-token" })
      .expect(204);
  });

  it.each(PUBLIC_CART_TOKEN_ROUTES)("still requires a CSRF token on %s", async (path) => {
    await request(app).post(path).send({ token: "not-a-real-token" }).expect(403);
  });
});

describe("admin password reset", () => {
  /** An agent with a valid CSRF token but no session behind it. */
  async function anonymous() {
    const agent = request.agent(app);
    const { body } = await agent.get("/api/session").expect(200);
    return { agent, csrf: body.csrfToken as string };
  }

  it.each(ADMIN_PASSWORD_RESET_ROUTES)("still requires a CSRF token on %s", async (path) => {
    await request(app).post(path).send({}).expect(403);
  });

  it("is reachable while signed out — that is the point of the route", async () => {
    const { agent, csrf } = await anonymous();
    await agent
      .post("/api/session/forgot-password")
      .set("x-csrf-token", csrf)
      .send({ email: "not-an-admin@example.com" })
      .expect(204);
  });

  it("does not disclose whether the email belongs to an administrator", async () => {
    const known = await anonymous();
    const knownResponse = await known.agent
      .post("/api/session/forgot-password")
      .set("x-csrf-token", known.csrf)
      .send({ email: "admin@example.com" });

    const unknown = await anonymous();
    const unknownResponse = await unknown.agent
      .post("/api/session/forgot-password")
      .set("x-csrf-token", unknown.csrf)
      .send({ email: "no-such-admin@example.com" });

    expect(knownResponse.status).toBe(204);
    expect(unknownResponse.status).toBe(204);
    expect(knownResponse.body).toEqual(unknownResponse.body);
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

  it("rejects a duplicate SKU and names the other product", async () => {
    const { agent, csrf } = await signIn();

    const response = await agent
      .post("/api/admin/products")
      .set("x-csrf-token", csrf)
      .send({
        slug: "sku-duplicate",
        name: "SKU Duplicate",
        // Seeded on the demo tote's small variant.
        variants: [{ priceCents: 100, sku: "CANVAS-TOTE-S", inventory: { type: "infinite" } }],
      })
      .expect(409);

    expect(response.body.error).toMatch(/already.*use/i);
    expect(response.body.error).toContain("Canvas Tote");
  });

  it("rejects a compare-at price that is not strictly greater than the price", async () => {
    const { agent, csrf } = await signIn();

    const response = await agent
      .post("/api/admin/products")
      .set("x-csrf-token", csrf)
      .send({
        slug: "compare-at-not-a-markdown",
        name: "Compare-at Not a Markdown",
        variants: [
          { priceCents: 1000, compareAtPriceCents: 1000, inventory: { type: "infinite" } },
        ],
      })
      .expect(400);

    expect(response.body.error).toMatch(/compareAtPriceCents/);
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

/**
 * The storefront password gate — see docs/tasks/27-storefront-preview-mode.md.
 *
 * Runs last and cleans up after itself in `afterAll`: every describe block
 * above assumes a public storefront, and vitest runs a file's tests in
 * declaration order rather than concurrently, so locking here does not race
 * them as long as nothing below reopens the store early.
 */
describe("storefront lock", () => {
  const STOREFRONT_PASSWORD = "a-sufficiently-long-storefront-password";

  const LOCKED = [
    "/api/store",
    "/api/products",
    "/api/products/canvas-tote",
    "/api/collections",
    "/api/pages",
    "/api/account",
  ] as const;

  beforeAll(async () => {
    const { agent, csrf } = await signIn();

    await agent
      .put("/api/admin/storefront/password")
      .set("x-csrf-token", csrf)
      .send({ password: STOREFRONT_PASSWORD })
      .expect(204);

    await agent
      .put("/api/admin/storefront")
      .set("x-csrf-token", csrf)
      .send({ access: "password" })
      .expect(204);
  });

  afterAll(async () => {
    const { agent, csrf } = await signIn();
    // Clearing the password also resets access to "public" — see
    // `clearStorefrontPassword` in db/admin-repository.ts.
    await agent.delete("/api/admin/storefront/password").set("x-csrf-token", csrf).expect(204);
  });

  it.each(LOCKED)("rejects an anonymous GET %s with 401", async (path) => {
    const response = await request(app).get(path);
    expect(response.status).toBe(401);
    expect(response.body.needsStorefrontPassword).toBe(true);
  });

  it("still answers the webhook and the health check while locked", async () => {
    await request(app).get("/api/health").expect(200);
    // No valid Stripe signature is sent, so this fails verification rather
    // than succeeding — the point is that it is not the *gate* refusing it.
    const response = await request(app).post("/api/webhooks/stripe").send({});
    expect(response.status).not.toBe(401);
  });

  it("still lets an administrator reach the admin API with no storefront password", async () => {
    const { agent } = await signIn();
    await agent.get("/api/admin/products").expect(200);
  });

  it("refuses the wrong password", async () => {
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    await agent.post("/api/storefront/unlock").send({ password: "not-it" }).expect(401);
  });

  it.each(LOCKED)("answers GET %s once unlocked with the password", async (path) => {
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    await agent.post("/api/storefront/unlock").send({ password: STOREFRONT_PASSWORD }).expect(204);

    await agent.get(path).expect(200);
  });

  it("unlocks with a share link and strips it from nothing the server needs to see", async () => {
    const { agent: admin, csrf } = await signIn();
    const { body } = await admin
      .post("/api/admin/storefront/share-link")
      .set("x-csrf-token", csrf)
      .send({})
      .expect(201);

    const token = new URL(body.url as string).searchParams.get("preview");
    expect(token).toBeTruthy();

    const visitor = request.agent(app);
    await visitor.get("/api/session").expect(200);
    await visitor.post("/api/storefront/unlock").send({ token }).expect(204);
    await visitor.get("/api/store").expect(200);
  });

  it("ends every existing viewer session when the password changes, but not the admin's", async () => {
    const agent = request.agent(app);
    await agent.get("/api/session").expect(200);
    await agent.post("/api/storefront/unlock").send({ password: STOREFRONT_PASSWORD }).expect(204);
    await agent.get("/api/store").expect(200);

    const { agent: admin, csrf } = await signIn();
    await admin
      .put("/api/admin/storefront/password")
      .set("x-csrf-token", csrf)
      .send({ password: "a-different-storefront-password" })
      .expect(204);

    await agent.get("/api/store").expect(401);
    await admin.get("/api/admin/products").expect(200);

    // Restore the fixture password so the rest of this file's assertions
    // (and this describe block's own `afterAll`) still hold.
    await admin
      .put("/api/admin/storefront/password")
      .set("x-csrf-token", csrf)
      .send({ password: STOREFRONT_PASSWORD })
      .expect(204);
  });
});

/**
 * Task 29, group 4 — and why this file, deliberately last.
 *
 * `loginRateLimit` used to be one instance shared by the admin login, invite
 * acceptance, the admin password change, the customer login, email
 * verification and the customer password reset. Ten wrong customer passwords
 * from one address locked the merchant out of their own admin for fifteen
 * minutes — a shared office NAT or a campus turns that into a lockout nobody
 * inside can explain. This test deliberately exhausts one surface's limiter,
 * which is real, fifteen-minute state that nothing declared above may run
 * into — hence last, after every other describe block's own `signIn()` and
 * `signInCustomer()` calls are done needing a live login.
 */
describe("login rate limits", () => {
  async function csrfAgent() {
    const agent = request.agent(app);
    const { body } = await agent.get("/api/session").expect(200);
    return { agent, csrf: body.csrfToken as string };
  }

  it("does not let the customer limiter's exhaustion touch the admin login", async () => {
    // The limit is 10 per window, and a failed attempt (401) counts — only a
    // successful one is skipped. Ten get through as ordinary wrong-password
    // rejections; the eleventh is the limiter itself answering.
    for (let i = 0; i < 10; i += 1) {
      const { agent, csrf } = await csrfAgent();
      await agent
        .post("/api/account/session")
        .set("x-csrf-token", csrf)
        .send({ email: "customer@example.com", password: "wrong" })
        .expect(401);
    }

    const { agent: exhausted, csrf: exhaustedCsrf } = await csrfAgent();
    await exhausted
      .post("/api/account/session")
      .set("x-csrf-token", exhaustedCsrf)
      .send({ email: "customer@example.com", password: "wrong" })
      .expect(429);

    // A separate limiter: the admin surface must still answer normally.
    const { agent: admin, csrf: adminCsrf } = await csrfAgent();
    await admin
      .post("/api/session")
      .set("x-csrf-token", adminCsrf)
      .send({ email: "admin@example.com", password: "wrong" })
      .expect(401);
  });
});
