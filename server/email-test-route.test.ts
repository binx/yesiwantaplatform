import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * "Send a test email".
 *
 * This is the only send in the codebase that reports its failure rather than
 * swallowing it, so the assertions here are about the two things that makes
 * load-bearing: the transport's own words survive the round trip, and the
 * recipient is the session's administrator and nothing a caller can choose.
 * The second matters because an admin session must not become a way to push
 * mail at strangers over the merchant's own SMTP reputation.
 */

/** Every message nodemailer was asked to send, newest last. */
const sent: { from?: string; to?: string; subject?: string; html?: string }[] = [];

/** What the fake transport should do on the next call. */
let failWith: Error | null = null;

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: (message: { from?: string; to?: string; subject?: string; html?: string }) => {
        sent.push(message);
        if (failWith) return Promise.reject(failWith);
        return Promise.resolve({ messageId: "test" });
      },
    }),
  },
}));

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

async function signIn(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);

  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email, password })
    .expect(200);

  return { agent, csrf: (login.body.csrfToken ?? bootstrap.body.csrfToken) as string };
}

beforeAll(async () => {
  // `server/env.ts` parses once on first import, so SMTP has to look
  // configured before anything below is loaded — otherwise the route short
  // -circuits on "not configured" and never reaches the transport at all.
  process.env.SMTP_URL = "smtps://user:pass@smtp.example.com:465";
  process.env.EMAIL_FROM = "store@example.com";

  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("owner@example.com", PASSWORD);
  await createAdmin("colleague@example.com", PASSWORD);

  app = createApp();
});

beforeEach(() => {
  sent.length = 0;
  failWith = null;
});

describe("POST /api/admin/email/test", () => {
  it("sends to the signed-in administrator", async () => {
    const { agent, csrf } = await signIn("owner@example.com");

    const response = await agent
      .post("/api/admin/email/test")
      .set("x-csrf-token", csrf)
      .send({})
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("owner@example.com");
  });

  it("ignores a recipient in the body, so it cannot mail a stranger", async () => {
    const { agent, csrf } = await signIn("owner@example.com");

    await agent
      .post("/api/admin/email/test")
      .set("x-csrf-token", csrf)
      .send({ to: "victim@example.com", email: "victim@example.com" })
      .expect(200);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("owner@example.com");
    expect(JSON.stringify(sent)).not.toContain("victim@example.com");
  });

  it("follows the session, not the store's first account", async () => {
    const { agent, csrf } = await signIn("colleague@example.com");

    await agent.post("/api/admin/email/test").set("x-csrf-token", csrf).send({}).expect(200);

    expect(sent[0]!.to).toBe("colleague@example.com");
  });

  it("hands back the transport's own error rather than swallowing it", async () => {
    failWith = new Error("535 5.7.8 Authentication credentials invalid");

    const { agent, csrf } = await signIn("owner@example.com");

    const response = await agent
      .post("/api/admin/email/test")
      .set("x-csrf-token", csrf)
      .send({})
      .expect(200);

    // A 200 carrying `ok: false`: the request succeeded, the send did not, and
    // the provider's own words are the whole diagnosis.
    expect(response.body.ok).toBe(false);
    expect(response.body.message).toContain("535");
  });

  it("refuses a caller with no admin session", async () => {
    // 401 rather than 403: `requireAdmin` runs ahead of `verifyCsrf` on the
    // router, so an anonymous caller is turned away before CSRF is considered.
    await request(app).post("/api/admin/email/test").send({}).expect(401);
    expect(sent).toHaveLength(0);
  });
});
