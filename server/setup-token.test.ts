import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * The setup token.
 *
 * `POST /api/setup` creates an administrator for whoever calls it, and a fresh
 * public deploy is reachable by scanners before its owner has opened the
 * wizard. In production a token printed only in the server log gates it. The
 * token is generated in production and absent in test, so this file sets
 * SETUP_TOKEN explicitly — which also makes it required — before the server
 * modules are first imported.
 */

const TOKEN = "a-test-setup-token-nobody-guesses";

let app: Express;

beforeAll(async () => {
  process.env.SETUP_TOKEN = TOKEN;

  const { runMigrations } = await import("../db/migrate.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  app = createApp();
});

afterAll(() => {
  delete process.env.SETUP_TOKEN;
});

const VALID = {
  storeName: "Gated Store",
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

async function visitor() {
  const agent = request.agent(app);
  const { body } = await agent.get("/api/session").expect(200);
  return { agent, csrf: body.csrfToken as string };
}

describe("with SETUP_TOKEN set", () => {
  it("tells the wizard a token is required, without revealing it", async () => {
    const { body } = await request(app).get("/api/setup").expect(200);

    expect(body).toMatchObject({ needsSetup: true, requiresToken: true });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("refuses a submission with no token", async () => {
    const { agent, csrf } = await visitor();

    const response = await agent
      .post("/api/setup")
      .set("x-csrf-token", csrf)
      .send(VALID)
      .expect(403);

    expect(response.body.error).toMatch(/setup token/i);
  });

  it("refuses a wrong token", async () => {
    const { agent, csrf } = await visitor();

    await agent
      .post("/api/setup")
      .set("x-csrf-token", csrf)
      .send({ ...VALID, setupToken: `${TOKEN}-but-wrong` })
      .expect(403);

    const { countAdmins } = await import("./auth.js");
    expect(await countAdmins()).toBe(0);
  });

  it("completes setup with the right token, and only then", async () => {
    const { agent, csrf } = await visitor();

    const response = await agent
      .post("/api/setup")
      .set("x-csrf-token", csrf)
      .send({ ...VALID, setupToken: TOKEN })
      .expect(201);

    expect(response.body.isAdmin).toBe(true);

    const { countAdmins } = await import("./auth.js");
    expect(await countAdmins()).toBe(1);

    // Once configured the status collapses as before — no token detail either.
    const { body } = await request(app).get("/api/setup").expect(200);
    expect(body).toEqual({ needsSetup: false });
  });
});
