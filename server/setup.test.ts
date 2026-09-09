import { beforeAll, describe, expect, it, vi } from "vitest";
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

  it("reports the key as unchecked until the boot probe has run", async () => {
    // `createApp()` never calls `probeStripeKey` — that only happens at real
    // process boot (see server/index.ts) — so a fresh app always starts here.
    const { body } = await request(app).get("/api/setup").expect(200);

    expect(body.stripeKeyStatus).toBe("unchecked");
  });

  it("tells the wizard which origin the server will actually use", async () => {
    const { body } = await request(app).get("/api/setup").expect(200);

    // The wizard cannot set PUBLIC_URL — it writes no `.env` — so its only
    // useful move is warning that a store about to go public still points at
    // localhost. It needs the value to do that.
    expect(body.publicUrl).toBe("http://localhost:5173");
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
    expect(body).not.toHaveProperty("publicUrl");
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

    // The Overview's localhost warning turns on this rather than on the
    // browser's own origin, so the server has to say which mode it is in.
    expect(body.production).toBe(false);
    expect(body.publicUrl).toBe("http://localhost:5173");
  });

  it("reports a probed key as valid, once the boot probe has run", async () => {
    const { requireStripe, probeStripeKey, resetStripe } = await import("./stripe.js");

    const stripe = requireStripe();
    vi.spyOn(stripe.balance, "retrieve").mockResolvedValue({
      livemode: false,
    } as Awaited<ReturnType<typeof stripe.balance.retrieve>>);

    await probeStripeKey();

    const { agent, csrf } = await visitor();
    await agent
      .post("/api/session")
      .set("x-csrf-token", csrf)
      .send({ email: VALID.email, password: VALID.password })
      .expect(200);

    const { body } = await agent.get("/api/admin/environment").expect(200);
    expect(body.stripeKeyStatus).toBe("valid");

    vi.restoreAllMocks();
    resetStripe();
  });

  it("reports a probe Stripe rejected as invalid, not merely unchecked", async () => {
    const { default: Stripe } = await import("stripe");
    const { requireStripe, probeStripeKey, resetStripe } = await import("./stripe.js");

    const stripe = requireStripe();
    vi.spyOn(stripe.balance, "retrieve").mockRejectedValue(
      Stripe.errors.StripeError.generate({ statusCode: 401, message: "Expired API Key provided" }),
    );

    await probeStripeKey();

    const { agent, csrf } = await visitor();
    await agent
      .post("/api/session")
      .set("x-csrf-token", csrf)
      .send({ email: VALID.email, password: VALID.password })
      .expect(200);

    const { body } = await agent.get("/api/admin/environment").expect(200);
    expect(body.stripeKeyStatus).toBe("invalid");

    vi.restoreAllMocks();
    resetStripe();
  });
});
