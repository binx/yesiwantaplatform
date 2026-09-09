import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Routes that send mail to an address the caller chose must count every
 * request, not just the failed ones.
 *
 * The login limiter skips successful responses, and a password-reset request
 * is always "successful" — it answers 204 for unknown emails on purpose. Under
 * that limiter the route never counted at all, so a loop could push unlimited
 * mail at any inbox through the merchant's SMTP. This file gets its own app
 * and therefore its own limiter, so the count here starts at zero.
 */

let app: Express;

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  app = createApp();
});

async function bootstrap() {
  const agent = request.agent(app);
  const session = await agent.get("/api/session").expect(200);
  return { agent, csrf: session.body.csrfToken as string };
}

describe("email-sending routes", () => {
  it("stops answering a password-reset flood after the ceiling, successes included", async () => {
    const { agent, csrf } = await bootstrap();

    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const response = await agent
        .post("/api/account/password/forgot")
        .set("x-csrf-token", csrf)
        .send({ email: "victim@example.com" });
      statuses.push(response.status);
    }

    // Ten through, then refused — the 204s counted.
    expect(statuses.slice(0, 10).every((status) => status === 204)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("shares that ceiling with registration, which also sends mail", async () => {
    const { agent, csrf } = await bootstrap();

    const response = await agent
      .post("/api/account/register")
      .set("x-csrf-token", csrf)
      .send({ email: "another-victim@example.com", password: "a-sufficiently-long-password" });

    expect(response.status).toBe(429);
  });
});
