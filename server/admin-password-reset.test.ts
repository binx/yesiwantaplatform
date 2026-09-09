import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type * as EmailModule from "./email.js";

// Wraps the real implementation by default, so every test but the one below
// still gets the unconfigured-SMTP no-op it always got. See the timing test
// in the "password reset" block for why this exists.
vi.mock("./email.js", async (importOriginal) => {
  const actual = await importOriginal<typeof EmailModule>();
  return { ...actual, sendAccountEmail: vi.fn(actual.sendAccountEmail) };
});

/**
 * An administrator resetting a forgotten password.
 *
 * The mirror of the "password reset" describe block in customers.test.ts —
 * same shape, on `admin_users` instead of `customers`. Reset links are never
 * returned over HTTP, so tests mint them the same way the (unconfigured, in
 * this suite) email would have: by calling the exported token functions
 * directly, exactly as the route does.
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

async function bootstrap() {
  const agent = request.agent(app);
  const session = await agent.get("/api/session").expect(200);
  return { agent, csrf: session.body.csrfToken as string };
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();

  app = createApp();
});

describe("password reset", () => {
  it("is single-use and rejects a second attempt", async () => {
    const email = "resetter@example.com";
    const { createAdmin, createAdminPasswordResetToken } = await import("./auth.js");
    await createAdmin(email, PASSWORD, "staff");

    const token = await createAdminPasswordResetToken(email);
    expect(token).toBeTruthy();

    const { agent, csrf } = await bootstrap();
    await agent
      .post("/api/session/reset-password")
      .set("x-csrf-token", csrf)
      .send({ token, password: "a-brand-new-long-password" })
      .expect(204);

    // The new password works.
    const signedIn = await bootstrap();
    await signedIn.agent
      .post("/api/session")
      .set("x-csrf-token", signedIn.csrf)
      .send({ email, password: "a-brand-new-long-password" })
      .expect(200);

    // The token cannot be replayed.
    const replay = await bootstrap();
    const response = await replay.agent
      .post("/api/session/reset-password")
      .set("x-csrf-token", replay.csrf)
      .send({ token, password: "yet-another-long-password" })
      .expect(410);
    expect(response.body.error).toMatch(/not valid|already been used/i);
  });

  it("signs out every session the account had", async () => {
    const email = "hijacked-admin@example.com";
    const { createAdmin, createAdminPasswordResetToken } = await import("./auth.js");
    await createAdmin(email, PASSWORD, "staff");

    // Someone — perhaps not the owner — is signed in already.
    const intruder = await bootstrap();
    await intruder.agent
      .post("/api/session")
      .set("x-csrf-token", intruder.csrf)
      .send({ email, password: PASSWORD })
      .expect(200);
    await intruder.agent.get("/api/admin/users").expect(200);

    const token = await createAdminPasswordResetToken(email);
    const { agent, csrf } = await bootstrap();
    await agent
      .post("/api/session/reset-password")
      .set("x-csrf-token", csrf)
      .send({ token, password: "a-brand-new-long-password" })
      .expect(204);

    // Not "until the cookie expires" — now, and every session, not just this one.
    await intruder.agent.get("/api/admin/users").expect(401);
  });

  it("expires after its window", async () => {
    const email = "expired-admin-reset@example.com";
    const { createAdmin, createAdminPasswordResetToken } = await import("./auth.js");
    await createAdmin(email, PASSWORD, "staff");
    const token = await createAdminPasswordResetToken(email);

    // Back-date the expiry directly, rather than waiting an hour.
    const { getDatabase } = await import("../db/client.js");
    const { eq } = await import("drizzle-orm");
    const { drizzle: db, schema, dialect } = await getDatabase();
    const past = dialect === "pg" ? new Date(0) : 0;
    await db
      .update(schema.adminUsers)
      .set({ passwordResetExpiresAt: past })
      .where(eq(schema.adminUsers.email, email));

    const { agent, csrf } = await bootstrap();
    const response = await agent
      .post("/api/session/reset-password")
      .set("x-csrf-token", csrf)
      .send({ token, password: "a-brand-new-long-password" })
      .expect(410);

    expect(response.body.error).toMatch(/expired/i);
  });

  it("answers identically for a known and an unknown email", async () => {
    const { createAdmin } = await import("./auth.js");
    await createAdmin("has-an-admin-account@example.com", PASSWORD, "staff");

    const known = await bootstrap();
    const knownResponse = await known.agent
      .post("/api/session/forgot-password")
      .set("x-csrf-token", known.csrf)
      .send({ email: "has-an-admin-account@example.com" });

    const unknown = await bootstrap();
    const unknownResponse = await unknown.agent
      .post("/api/session/forgot-password")
      .set("x-csrf-token", unknown.csrf)
      .send({ email: "no-such-admin-account@example.com" });

    expect(knownResponse.status).toBe(204);
    expect(unknownResponse.status).toBe(204);
    expect(knownResponse.body).toEqual(unknownResponse.body);
  });

  /**
   * Task 29, group 1: the send used to be awaited, so a stopwatch on this
   * route could tell a real admin email from an unknown one by the hundreds
   * of milliseconds an SMTP round trip takes — exactly the enumeration the
   * identical 204 was written to prevent. A timing assertion would be flaky;
   * the property that actually matters is that the response does not wait on
   * the send at all, which a promise that never resolves proves directly —
   * if the route ever went back to awaiting it, this test would time out.
   */
  it("answers before the reset email finishes sending", async () => {
    const { sendAccountEmail } = await import("./email.js");
    let release: (sent: boolean) => void = () => {};
    vi.mocked(sendAccountEmail).mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );

    const email = "slow-smtp-admin@example.com";
    const { createAdmin } = await import("./auth.js");
    await createAdmin(email, PASSWORD, "staff");

    const { agent, csrf } = await bootstrap();
    await agent
      .post("/api/session/forgot-password")
      .set("x-csrf-token", csrf)
      .send({ email })
      .expect(204);

    release(true);
  });

  it("rejects a password that is too short", async () => {
    const email = "shortpw-admin@example.com";
    const { createAdmin, createAdminPasswordResetToken } = await import("./auth.js");
    await createAdmin(email, PASSWORD, "staff");
    const token = await createAdminPasswordResetToken(email);

    const { agent, csrf } = await bootstrap();
    await agent
      .post("/api/session/reset-password")
      .set("x-csrf-token", csrf)
      .send({ token, password: "short" })
      .expect(400);
  });
});
