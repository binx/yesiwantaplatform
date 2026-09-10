import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

/** "Send a test email": the transport's own words survive, and the recipient is never chosen by the caller. */

const sent: { to?: string; subject?: string }[] = [];
let failWith: Error | null = null;

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: (message: { to?: string; subject?: string }) => {
        sent.push(message);
        if (failWith) return Promise.reject(failWith);
        return Promise.resolve({ messageId: "test" });
      },
    }),
  },
}));

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

async function signIn(email: string) {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);
  const login = await agent.post("/api/session").set("x-csrf-token", bootstrap.body.csrfToken as string).send({ email, password: PASSWORD }).expect(200);
  return { agent, csrf: login.body.csrfToken as string };
}

beforeAll(async () => {
  process.env.SMTP_URL = "smtps://user:pass@smtp.example.com:465";
  process.env.EMAIL_FROM = "store@example.com";

  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");
  await runMigrations();
  await seedIfEmpty();
  await createAdmin("owner@example.com", PASSWORD);
  app = createApp();
});

beforeEach(() => {
  sent.length = 0;
  failWith = null;
});

describe("POST /api/admin/email/test", () => {
  it("sends to the signed-in administrator and ignores a recipient in the body", async () => {
    const { agent, csrf } = await signIn("owner@example.com");
    const response = await agent.post("/api/admin/email/test").set("x-csrf-token", csrf).send({ to: "victim@example.com" }).expect(200);
    expect(response.body.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("owner@example.com");
  });

  it("hands back the transport's own error rather than swallowing it", async () => {
    failWith = new Error("535 5.7.8 Authentication credentials invalid");
    const { agent, csrf } = await signIn("owner@example.com");
    const response = await agent.post("/api/admin/email/test").set("x-csrf-token", csrf).send({}).expect(200);
    expect(response.body.ok).toBe(false);
    expect(response.body.message).toContain("535");
  });
});

describe("POST /api/admin/lob/test", () => {
  it("says plainly that Lob is not configured, rather than a 500", async () => {
    const { agent, csrf } = await signIn("owner@example.com");
    const response = await agent.post("/api/admin/lob/test").set("x-csrf-token", csrf).send({}).expect(200);
    expect(response.body.ok).toBe(false);
    expect(response.body.message).toMatch(/LOB_API_KEY/);
  });
});
