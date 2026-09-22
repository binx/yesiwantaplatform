import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import sharp from "sharp";

/**
 * The authorization model, asserted rather than spot-checked.
 *
 * Three surfaces: the admin (`adminId`), a signed-in customer (`customerId`),
 * and an artist, which is a customer with an artist row. Every admin route is
 * behind `requireAdmin` + `verifyCsrf`, every studio route behind
 * `requireCustomer` + an artist row; this file is what stops a new endpoint
 * from shipping outside them. A customer session must never reach an admin
 * route, an admin session must never satisfy a customer one, and a customer
 * with no artist page must never reach the studio.
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin, createCustomer } = await import("./auth.js");
  const { createArtist } = await import("../db/artists-repository.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("admin@example.com", PASSWORD);
  await createCustomer("customer@example.com", PASSWORD, null);
  const artistCustomer = await createCustomer("artist@example.com", PASSWORD, "Rachel");
  await createArtist(artistCustomer, { slug: "rachel", name: "Rachel", tagline: null, bio: "", monthlyPriceCents: 500, sendDay: 15, visibility: "public", avatar: null });

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

async function signInCustomer(email = "customer@example.com") {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);
  const login = await agent
    .post("/api/account/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email, password: PASSWORD })
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
  { method: "post", path: "/api/admin/payouts/run" },
  { method: "post", path: "/api/admin/payouts/some-payout/retry" },
  { method: "post", path: "/api/admin/artists/some-artist/status" },
  { method: "post", path: "/api/admin/postcards/some-card/retry" },
  { method: "post", path: "/api/admin/postcards/some-card/cancel" },
  { method: "put", path: "/api/admin/users/me/password" },
] as const;

const READS = [
  "/api/admin/environment",
  "/api/admin/overview",
  "/api/admin/fulfilment",
  "/api/admin/pages",
  "/api/admin/settings",
  "/api/admin/artists",
  "/api/admin/artists/some-artist",
  "/api/admin/customers",
  "/api/admin/subscriptions",
  "/api/admin/mailings",
  "/api/admin/mailings/some-mailing",
  "/api/admin/postcards/errors",
  "/api/admin/payouts",
  "/api/admin/orders",
] as const;

const CUSTOMER_MUTATIONS = [
  { method: "put", path: "/api/account" },
  { method: "put", path: "/api/account/address" },
  { method: "post", path: "/api/account/subscriptions/some-subscription/cancel" },
  { method: "post", path: "/api/account/subscriptions/some-subscription/resume" },
  { method: "post", path: "/api/checkout/subscribe" },
  { method: "post", path: "/api/studio" },
] as const;

const CUSTOMER_READS = [
  "/api/account/subscriptions",
  "/api/account/postcards",
  "/api/account/orders",
  "/api/checkout/some-session",
  "/api/checkout/address/me",
  "/api/studio",
  "/api/studio/slug/whatever",
] as const;

const STUDIO_MUTATIONS = [
  { method: "put", path: "/api/studio/profile" },
  { method: "post", path: "/api/studio/avatar" },
  { method: "post", path: "/api/studio/status" },
  { method: "post", path: "/api/studio/designs" },
  { method: "put", path: "/api/studio/designs/some-design" },
  { method: "delete", path: "/api/studio/designs/some-design" },
  { method: "post", path: "/api/studio/mailings" },
  { method: "put", path: "/api/studio/mailings/some-mailing" },
  { method: "delete", path: "/api/studio/mailings/some-mailing" },
  { method: "post", path: "/api/studio/payouts/onboard" },
  { method: "post", path: "/api/studio/payouts/refresh" },
] as const;

const STUDIO_READS = [
  "/api/studio",
  "/api/studio/designs",
  "/api/studio/mailings",
  "/api/studio/mailings/some-mailing/postcards",
  "/api/studio/subscribers",
  "/api/studio/earnings",
] as const;

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

  it("still serves the public platform", async () => {
    const response = await request(app).get("/api/store").expect(200);
    expect(response.body.name).toBeTruthy();
    expect(response.body.pricing.printCostCents).toBe(120);
  });

  it("serves the crawler files", async () => {
    await request(app).get("/sitemap.xml").expect(200);
    await request(app).get("/robots.txt").expect(200);
  });

  it("lists only live artists, and hides a draft page", async () => {
    const list = await request(app).get("/api/artists").expect(200);
    expect(list.body).toEqual([]);
    await request(app).get("/api/artists/rachel").expect(404);
    const gallery = await request(app).get("/api/gallery").expect(200);
    expect(gallery.body).toEqual({ cards: [], nextCursor: null });
  });
});

describe("Content-Security-Policy", () => {
  it("always sends upgrade-insecure-requests", async () => {
    const response = await request(app).get("/api/health").expect(200);
    expect(response.headers["content-security-policy"] ?? "").toContain("upgrade-insecure-requests");
  });

  it("always allows the card fonts' own origins, regardless of the theme font", async () => {
    const response = await request(app).get("/api/health").expect(200);
    const csp = response.headers["content-security-policy"] ?? "";
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
  });
});

const SETTINGS = {
  name: "Renamed",
  currency: "USD",
  stripePublishableKey: null,
  pricing: { printCostCents: 120, platformFeeCents: 60, minMonthlyPriceCents: 300 },
  theme: { colorPrimary: "#18181b", colorAccent: "#e07a5f", fontFamily: "system-ui", borderRadius: 2 },
};

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
    await agent.put("/api/admin/settings").set("x-csrf-token", csrf).send(SETTINGS).expect(204);
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

  it("tells a customer which artist page is theirs, and a plain customer none", async () => {
    const plain = await signInCustomer();
    expect((await plain.agent.get("/api/account").expect(200)).body.customer.artistSlug).toBeNull();
    const artist = await signInCustomer("artist@example.com");
    expect((await artist.agent.get("/api/account").expect(200)).body.customer.artistSlug).toBe("rachel");
  });
});

describe("studio routes", () => {
  it.each(STUDIO_MUTATIONS)("refuses a customer with no artist page on $method $path", async ({ method, path }) => {
    const { agent, csrf } = await signInCustomer();
    const response = await agent[method](path).set("x-csrf-token", csrf).send({});
    expect(response.status).toBe(404);
    expect(response.body.needsArtist).toBe(true);
  });

  it.each(STUDIO_READS)("refuses a customer with no artist page on GET %s", async (path) => {
    const { agent } = await signInCustomer();
    const response = await agent.get(path);
    expect(response.status).toBe(404);
    expect(response.body.needsArtist).toBe(true);
  });

  it.each(STUDIO_READS)("refuses an admin session on GET %s", async (path) => {
    const { agent } = await signIn();
    await agent.get(path).expect(401);
  });

  it("answers the artist's own studio, and never another artist's id", async () => {
    const { agent } = await signInCustomer("artist@example.com");
    const studio = await agent.get("/api/studio").expect(200);
    expect(studio.body.artist.slug).toBe("rachel");
    expect(studio.body.artist.email).toBe("artist@example.com");
    // A design id from nowhere is a 404, not a 403 with the body attached.
    await agent.get("/api/studio/mailings/not-mine/postcards").expect(404);
  });

  it("refuses to go live with an empty queue", async () => {
    const { agent, csrf } = await signInCustomer("artist@example.com");
    const response = await agent.post("/api/studio/status").set("x-csrf-token", csrf).send({ status: "live" });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/queue/i);
  });

  it("refuses a second artist page for the same account", async () => {
    const { agent, csrf } = await signInCustomer("artist@example.com");
    await agent
      .post("/api/studio")
      .set("x-csrf-token", csrf)
      .send({ slug: "rachel-two", name: "Rachel", monthlyPriceCents: 500 })
      .expect(409);
  });

  it("refuses a price below the platform's floor", async () => {
    const { agent, csrf } = await signInCustomer("artist@example.com");
    const response = await agent.put("/api/studio/profile").set("x-csrf-token", csrf).send({ slug: "rachel", name: "Rachel", monthlyPriceCents: 100 });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/at least/);
  });
});

describe("design uploads", () => {
  async function pngFixture() {
    return sharp({ create: { width: 40, height: 30, channels: 3, background: "#cccccc" } })
      .png()
      .toBuffer();
  }

  it("rejects a non-image that claims an image content type", async () => {
    const { agent, csrf } = await signInCustomer("artist@example.com");
    await agent
      .post("/api/studio/designs")
      .set("x-csrf-token", csrf)
      .field("orientation", "portrait")
      .attach("file", Buffer.from("#!/bin/sh\nrm -rf /\n"), { filename: "innocent.png", contentType: "image/png" })
      .expect(415);
  });

  it("discards the filename and stores under a generated id", async () => {
    const { agent, csrf } = await signInCustomer("artist@example.com");
    const response = await agent
      .post("/api/studio/designs")
      .set("x-csrf-token", csrf)
      .field("orientation", "landscape")
      .field("back", JSON.stringify({ text: "hi" }))
      .attach("file", await pngFixture(), { filename: "../../../../tmp/pwned.png", contentType: "image/png" })
      .expect(201);

    expect(response.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.thumbnail.path).toMatch(/^designs\/[0-9a-f-]{36}\/thumb\.webp$/);
    // Never the print path: a visitor is shown the thumbnail and nothing else.
    expect(JSON.stringify(response.body)).not.toContain("print.png");
  });

  it("refuses an unknown orientation", async () => {
    const { agent, csrf } = await signInCustomer("artist@example.com");
    await agent
      .post("/api/studio/designs")
      .set("x-csrf-token", csrf)
      .field("orientation", "square")
      .attach("file", await pngFixture(), { filename: "a.png", contentType: "image/png" })
      .expect(400);
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

describe("input validation", () => {
  it("refuses a Stripe secret key in the publishable key field", async () => {
    const { agent, csrf } = await signIn();
    const response = await agent
      .put("/api/admin/settings")
      .set("x-csrf-token", csrf)
      .send({ ...SETTINGS, stripePublishableKey: "sk_test_thisisasecretkey" })
      .expect(400);
    expect(response.body.error).toMatch(/secret key/i);
  });

  it("refuses a minimum price below Stripe's floor", async () => {
    const { agent, csrf } = await signIn();
    const response = await agent
      .put("/api/admin/settings")
      .set("x-csrf-token", csrf)
      .send({ ...SETTINGS, pricing: { ...SETTINGS.pricing, minMonthlyPriceCents: 10 } })
      .expect(400);
    expect(response.body.error).toMatch(/50 cents/i);
  });

  it("rejects a malformed reorder body with a 400, not a 500", async () => {
    const { agent, csrf } = await signIn();
    const response = await agent.post("/api/admin/pages/reorder").set("x-csrf-token", csrf).send({ ids: "nope" }).expect(400);
    expect(response.body.error).toBeTruthy();
  });

  it("refuses a reserved artist slug", async () => {
    const { agent, csrf } = await signInCustomer("artist@example.com");
    const response = await agent.put("/api/studio/profile").set("x-csrf-token", csrf).send({ slug: "admin", name: "Rachel", monthlyPriceCents: 500 });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/already/);
  });
});

describe("public API", () => {
  it("does not leak a secret key in the store payload", async () => {
    const response = await request(app).get("/api/store").expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(/sk_(test|live)_/);
  });

  it("refuses a subscription without Stripe, before it asks anything else", async () => {
    const { agent, csrf } = await signInCustomer();
    // The test environment sets a fake key, so this reaches the artist check: a draft artist is not subscribable.
    const response = await agent.post("/api/checkout/subscribe").set("x-csrf-token", csrf).send({ artistId: "nobody", address: {} });
    expect([400, 409, 503]).toContain(response.status);
  });
});
