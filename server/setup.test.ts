import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * First-run setup: it creates an administrator without being authenticated,
 * which is only safe while there is no administrator to impersonate.
 * This file deliberately does not seed.
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
  theme: { colorPrimary: "#18181b", colorAccent: "#e07a5f", fontFamily: "system-ui", borderRadius: 2 },
};

async function visitor() {
  const agent = request.agent(app);
  const { body } = await agent.get("/api/session").expect(200);
  return { agent, csrf: body.csrfToken as string };
}

describe("before setup", () => {
  it("reports that the store needs setting up", async () => {
    const { body } = await request(app).get("/api/setup").expect(200);
    expect(body).toMatchObject({ needsSetup: true, hasAdmin: false, hasSettings: false });
    expect(body).toHaveProperty("hasStripeSecret");
  });

  it("rejects a submission with no CSRF token", async () => {
    await request(app).post("/api/setup").send(VALID).expect(403);
  });

  it("rejects a password below the minimum", async () => {
    const { agent, csrf } = await visitor();
    const response = await agent.post("/api/setup").set("x-csrf-token", csrf).send({ ...VALID, password: "short" }).expect(400);
    expect(response.body.error).toMatch(/12 characters/i);
  });
});

describe("completing setup", () => {
  it("creates exactly one administrator when two submissions race", async () => {
    const [a, b] = await Promise.all([visitor(), visitor()]);
    const [first, second] = await Promise.all([
      a.agent.post("/api/setup").set("x-csrf-token", a.csrf).send(VALID),
      b.agent.post("/api/setup").set("x-csrf-token", b.csrf).send(VALID),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 410]);

    const { countAdmins } = await import("./auth.js");
    expect(await countAdmins()).toBe(1);
  });

  it("stores the currency uppercased, the store name as given, and the default price", async () => {
    const { getSettings } = await import("../db/repository.js");
    expect(await getSettings()).toMatchObject({ name: "Test Store", currency: "USD", pricing: { printCostCents: 120, platformFeeCents: 60, minMonthlyPriceCents: 300 } });
  });
});

describe("after setup", () => {
  it("stops reporting anything beyond the fact that setup is done", async () => {
    const { body } = await request(app).get("/api/setup").expect(200);
    expect(body).toEqual({ needsSetup: false });
  });

  it("refuses a further submission", async () => {
    const { agent, csrf } = await visitor();
    await agent.post("/api/setup").set("x-csrf-token", csrf).send({ ...VALID, email: "attacker@example.com" }).expect(410);
  });

  it("reports server wiring as booleans, never as values", async () => {
    const { agent, csrf } = await visitor();
    await agent.post("/api/session").set("x-csrf-token", csrf).send({ email: VALID.email, password: VALID.password }).expect(200);
    const { body } = await agent.get("/api/admin/environment").expect(200);
    expect(body).toMatchObject({ hasStripeSecret: true, stripeMode: "test", database: "sqlite", hasLob: false, lobMode: null });
    expect(JSON.stringify(body)).not.toMatch(/sk_(test|live)_/);
  });
});
