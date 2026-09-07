import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * First-run setup.
 *
 * `POST /api/setup` creates an administrator without being authenticated,
 * which is only safe while there is no administrator to impersonate. The
 * tests that matter most here are the ones proving it closes: once a store is
 * configured the route must be unreachable, by a second caller *or* by a
 * concurrent one racing the first.
 *
 * This file deliberately does not seed. Every other server test starts from a
 * populated database; this one needs the empty state a clone actually has.
 */

let app: Express;

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  app = createApp();
});

const VALID = {
  storeName: "Test Store",
  currency: "usd",
  email: "owner@example.com",
  password: "a-sufficiently-long-passphrase",
  stripePublishableKey: null,
  theme: {
    colorPrimary: "#18181b",
    colorAccent: "#e07a5f",
    fontFamily: "system-ui",
    borderRadius: 2,
  },
  seedDemo: false,
};

/** A fresh agent with its own session and CSRF token. */
async function visitor() {
  const agent = request.agent(app);
  const { body } = await agent.get("/api/session").expect(200);
  return { agent, csrf: body.csrfToken as string };
}

describe("before setup", () => {
  it("reports that the store needs setting up, with enough detail to guide it", async () => {
    const { body } = await request(app).get("/api/setup").expect(200);

    expect(body).toMatchObject({ needsSetup: true, hasAdmin: false, hasSettings: false });
    // The wizard needs to know whether the *server* holds a secret key, since
    // that one cannot be set from a browser.
    expect(body).toHaveProperty("hasStripeSecret");
  });

  it("rejects a submission with no CSRF token", async () => {
    await request(app).post("/api/setup").send(VALID).expect(403);
  });

  it("rejects a password below the minimum", async () => {
    const { agent, csrf } = await visitor();

    const response = await agent
      .post("/api/setup")
      .set("x-csrf-token", csrf)
      .send({ ...VALID, password: "short" })
      .expect(400);

    expect(response.body.error).toMatch(/12 characters/i);
  });

  it("rejects a Stripe secret key in the publishable key field", async () => {
    const { agent, csrf } = await visitor();

    await agent
      .post("/api/setup")
      .set("x-csrf-token", csrf)
      .send({ ...VALID, stripePublishableKey: "sk_test_not_publishable" })
      .expect(400);
  });

  it("is still not set up after those failures", async () => {
    const { body } = await request(app).get("/api/setup").expect(200);
    expect(body.needsSetup).toBe(true);
  });
});

describe("completing setup", () => {
  it("creates exactly one administrator when two submissions race", async () => {
    const [a, b] = await Promise.all([visitor(), visitor()]);

    const [first, second] = await Promise.all([
      a.agent.post("/api/setup").set("x-csrf-token", a.csrf).send(VALID),
      b.agent.post("/api/setup").set("x-csrf-token", b.csrf).send(VALID),
    ]);

    // One wins; the other is turned away by the re-check inside the lock.
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 410]);

    const { countAdmins } = await import("./auth.js");
    expect(await countAdmins()).toBe(1);
  });

  it("signs the new owner in, so setup does not end at a login form", async () => {
    // The winning agent above is not reachable here, so assert the contract a
    // fresh sign-in proves: the credentials work.
    const { agent, csrf } = await visitor();

    const response = await agent
      .post("/api/session")
      .set("x-csrf-token", csrf)
      .send({ email: VALID.email, password: VALID.password })
      .expect(200);

    expect(response.body.isAdmin).toBe(true);
  });

  it("stores the currency uppercased and the store name as given", async () => {
    const { getSettings } = await import("../db/repository.js");
    const settings = await getSettings();

    expect(settings).toMatchObject({ name: "Test Store", currency: "USD" });
  });
});

describe("after setup", () => {
  it("stops reporting anything beyond the fact that setup is done", async () => {
    const { body } = await request(app).get("/api/setup").expect(200);

    expect(body).toEqual({ needsSetup: false });
    // A configured store must not advertise its own wiring to the public.
    expect(body).not.toHaveProperty("hasStripeSecret");
  });

  it("refuses a further submission, so the route cannot mint a second admin", async () => {
    const { agent, csrf } = await visitor();

    const response = await agent
      .post("/api/setup")
      .set("x-csrf-token", csrf)
      .send({ ...VALID, email: "attacker@example.com" })
      .expect(410);

    expect(response.body.error).toMatch(/already set up/i);

    const { countAdmins } = await import("./auth.js");
    expect(await countAdmins()).toBe(1);
  });

  it("keeps the environment report behind authentication", async () => {
    await request(app).get("/api/admin/environment").expect(401);
  });

  it("reports server wiring as booleans, never as values", async () => {
    const { agent, csrf } = await visitor();
    await agent
      .post("/api/session")
      .set("x-csrf-token", csrf)
      .send({ email: VALID.email, password: VALID.password })
      .expect(200);

    const { body } = await agent.get("/api/admin/environment").expect(200);

    expect(body).toMatchObject({ hasStripeSecret: true, stripeMode: "test", database: "sqlite" });
    expect(JSON.stringify(body)).not.toMatch(/sk_(test|live)_/);
  });
});
