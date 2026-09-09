import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type * as EmailModule from "./email.js";

// Wraps the real implementation by default, so every test but the timing ones
// below still gets the unconfigured-SMTP no-op it always got. See those tests
// for why this exists.
vi.mock("./email.js", async (importOriginal) => {
  const actual = await importOriginal<typeof EmailModule>();
  return { ...actual, sendAccountEmail: vi.fn(actual.sendAccountEmail) };
});

/**
 * Customer accounts.
 *
 * The interesting assertions are the ones in docs/tasks/11-customer-accounts.md's
 * "Before starting" section: a customer session must never reach an admin
 * route (asserted in security.test.ts, not here), another customer's order
 * must be a 404 rather than a 403 with the body attached, and registration,
 * login and password-reset-request must not let an attacker distinguish a
 * known email from an unknown one.
 *
 * Verification and reset links are never returned over HTTP — that would be
 * the enumeration hole this whole feature exists to close — so tests mint
 * them the same way the (unconfigured, in this suite) email would have: by
 * calling the exported token functions directly, exactly as the routes do.
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

async function bootstrap() {
  const agent = request.agent(app);
  const session = await agent.get("/api/session").expect(200);
  return { agent, csrf: session.body.csrfToken as string };
}

async function customerIdForEmail(email: string): Promise<string> {
  const { getDatabase } = await import("../db/client.js");
  const { eq } = await import("drizzle-orm");
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.email, email))
    .limit(1)) as unknown as { id: string }[];

  return rows[0]!.id;
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();

  app = createApp();
});

/**
 * The session probe.
 *
 * `GET /api/account` is what every storefront page asks on first paint, so for
 * a signed-out shopper "nobody" is the ordinary answer rather than a refusal.
 * It used to answer 401, which the client read correctly as `null` and the
 * browser logged as a red failed request on every page load of a working
 * store. Everything else under `/api/account/*` keeps its 401, and that is the
 * half worth pinning down: the probe opening up must not open anything else.
 */
describe("the account probe", () => {
  it("answers 200 with a null customer when nobody is signed in", async () => {
    const response = await request(app).get("/api/account").expect(200);

    expect(response.body).toEqual({ customer: null });
  });

  it("still refuses every other account route without a session", async () => {
    await request(app).get("/api/account/orders").expect(401);
    await request(app).get("/api/account/addresses").expect(401);
    await request(app).get("/api/account/orders/anything").expect(401);
  });

  it("returns the customer once one is signed in", async () => {
    const email = "prober@example.com";
    const { agent, csrf } = await bootstrap();

    await agent
      .post("/api/account/register")
      .set("x-csrf-token", csrf)
      .send({ email, password: PASSWORD })
      .expect(204);

    const { createEmailVerificationToken } = await import("./auth.js");
    const token = await createEmailVerificationToken(await customerIdForEmail(email));

    // Verifying signs the customer in.
    await agent.post("/api/account/verify").set("x-csrf-token", csrf).send({ token }).expect(200);

    const response = await agent.get("/api/account").expect(200);

    expect(response.body.customer).toMatchObject({ email, emailVerified: true });
    // Never the columns that make an account an account.
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });
});

describe("registration and verification", () => {
  it("does not link orders until the email is verified, then links them", async () => {
    const email = "claiming@example.com";

    // A guest order placed under this email before any account exists.
    const { createPendingOrder, getOrderCustomerId } = await import(
      "../db/orders-repository.js"
    );
    const orderId = randomUUID();
    await createPendingOrder({
      id: orderId,
      checkoutSessionId: `cs_test_${orderId}`,
      email,
      currency: "USD",
      subtotalCents: 1000,
      lines: [],
    });

    const { agent, csrf } = await bootstrap();
    await agent
      .post("/api/account/register")
      .set("x-csrf-token", csrf)
      .send({ email, password: PASSWORD })
      .expect(204);

    // Registered, but nothing is linked yet.
    expect(await getOrderCustomerId(orderId)).toBeNull();

    const { createEmailVerificationToken } = await import("./auth.js");
    const customerId = await customerIdForEmail(email);
    const token = await createEmailVerificationToken(customerId);

    const verified = await agent
      .post("/api/account/verify")
      .set("x-csrf-token", csrf)
      .send({ token })
      .expect(200);

    expect(verified.body.csrfToken).toBeTruthy();
    // Verifying signs the customer in.
    expect(await getOrderCustomerId(orderId)).toBe(customerId);

    const orders = await agent.get("/api/account/orders").expect(200);
    expect((orders.body as { id: string }[]).some((o) => o.id === orderId)).toBe(true);
  });

  it("rejects a tampered verification token", async () => {
    const { agent, csrf } = await bootstrap();

    const response = await agent
      .post("/api/account/verify")
      .set("x-csrf-token", csrf)
      .send({ token: "not-a-real-token" })
      .expect(410);

    expect(response.body.error).toMatch(/not valid/i);
  });

  it("does not create a second account or change the password for a taken email", async () => {
    const email = "taken@example.com";

    const first = await bootstrap();
    await first.agent
      .post("/api/account/register")
      .set("x-csrf-token", first.csrf)
      .send({ email, password: PASSWORD })
      .expect(204);

    // Same response, same status, whether or not the email was free.
    const second = await bootstrap();
    const response = await second.agent
      .post("/api/account/register")
      .set("x-csrf-token", second.csrf)
      .send({ email, password: "a-totally-different-password" })
      .expect(204);
    expect(response.body).toEqual({});

    // The original password is still the one that works.
    const third = await bootstrap();
    await third.agent
      .post("/api/account/session")
      .set("x-csrf-token", third.csrf)
      .send({ email, password: PASSWORD })
      .expect(200);
  });

  /**
   * Task 29, group 1: the verification email used to be awaited, so with SMTP
   * configured a stopwatch on this route could tell a fresh registration from
   * one that hit `EmailTakenError` by the network round trip the send costs —
   * exactly the enumeration the identical 204 exists to prevent. A timing
   * assertion would be flaky; the property that matters is that the response
   * never waits on the send, which a promise that never resolves proves
   * directly — if the route ever went back to awaiting it, this test would
   * time out instead of passing.
   */
  it("answers before the verification email finishes sending", async () => {
    const { sendAccountEmail } = await import("./email.js");
    let release: (sent: boolean) => void = () => {};
    vi.mocked(sendAccountEmail).mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );

    const { agent, csrf } = await bootstrap();
    await agent
      .post("/api/account/register")
      .set("x-csrf-token", csrf)
      .send({ email: "slow-smtp@example.com", password: PASSWORD })
      .expect(204);

    release(true);
  });
});

describe("order access", () => {
  async function registeredAndVerified(email: string) {
    const { agent, csrf } = await bootstrap();
    await agent
      .post("/api/account/register")
      .set("x-csrf-token", csrf)
      .send({ email, password: PASSWORD })
      .expect(204);

    const { createEmailVerificationToken } = await import("./auth.js");
    const customerId = await customerIdForEmail(email);
    const token = await createEmailVerificationToken(customerId);

    const verified = await agent
      .post("/api/account/verify")
      .set("x-csrf-token", csrf)
      .send({ token })
      .expect(200);

    return { agent, csrf: verified.body.csrfToken as string, customerId };
  }

  it("404s another customer's order rather than exposing it", async () => {
    const owner = await registeredAndVerified("owner-of-order@example.com");
    const stranger = await registeredAndVerified("stranger@example.com");

    const { createPendingOrder } = await import("../db/orders-repository.js");
    const orderId = randomUUID();
    await createPendingOrder({
      id: orderId,
      checkoutSessionId: `cs_test_${orderId}`,
      email: "owner-of-order@example.com",
      currency: "USD",
      subtotalCents: 500,
      lines: [],
      customerId: owner.customerId,
    });

    await owner.agent.get(`/api/account/orders/${orderId}`).expect(200);

    // Not a 403 with the order attached — a 404, indistinguishable from an id
    // that never existed at all.
    await stranger.agent.get(`/api/account/orders/${orderId}`).expect(404);
  });

  it("requires a session to read an order at all", async () => {
    await request(app).get("/api/account/orders/anything").expect(401);
  });
});

describe("password reset", () => {
  it("is single-use and rejects a second attempt", async () => {
    const email = "resetter@example.com";
    const { createCustomer, createPasswordResetToken } = await import("./auth.js");
    await createCustomer(email, PASSWORD, null);

    const token = await createPasswordResetToken(email);
    expect(token).toBeTruthy();

    const { agent, csrf } = await bootstrap();
    await agent
      .post("/api/account/password/reset")
      .set("x-csrf-token", csrf)
      .send({ token, password: "a-brand-new-long-password" })
      .expect(204);

    // The new password works.
    const signedIn = await bootstrap();
    await signedIn.agent
      .post("/api/account/session")
      .set("x-csrf-token", signedIn.csrf)
      .send({ email, password: "a-brand-new-long-password" })
      .expect(200);

    // The token cannot be replayed.
    const replay = await bootstrap();
    const response = await replay.agent
      .post("/api/account/password/reset")
      .set("x-csrf-token", replay.csrf)
      .send({ token, password: "yet-another-long-password" })
      .expect(410);
    expect(response.body.error).toMatch(/not valid|already been used/i);
  });

  it("signs out every session the account had", async () => {
    const email = "hijacked@example.com";
    const { createCustomer, createPasswordResetToken } = await import("./auth.js");
    await createCustomer(email, PASSWORD, null);

    // Someone — perhaps not the owner — is signed in already.
    const intruder = await bootstrap();
    await intruder.agent
      .post("/api/account/session")
      .set("x-csrf-token", intruder.csrf)
      .send({ email, password: PASSWORD })
      .expect(200);
    const signedIn = await intruder.agent.get("/api/account").expect(200);
    expect(signedIn.body.customer).toMatchObject({ email });

    const token = await createPasswordResetToken(email);
    const { agent, csrf } = await bootstrap();
    await agent
      .post("/api/account/password/reset")
      .set("x-csrf-token", csrf)
      .send({ token, password: "a-brand-new-long-password" })
      .expect(204);

    /*
     * The reset is what the owner does when they suspect exactly this.
     *
     * The probe answers 200 for everyone now, so the assertion is on the body:
     * the intruder's cookie no longer resolves to a customer. Asserting a
     * status here would test the probe rather than the session destruction.
     * The routes that carry data still refuse them outright.
     */
    const after = await intruder.agent.get("/api/account").expect(200);
    expect(after.body.customer).toBeNull();

    await intruder.agent.get("/api/account/orders").expect(401);
    await intruder.agent.get("/api/account/addresses").expect(401);
  });

  it("expires after its window", async () => {
    const email = "expired-reset@example.com";
    const { createCustomer, createPasswordResetToken } = await import("./auth.js");
    await createCustomer(email, PASSWORD, null);
    const token = await createPasswordResetToken(email);

    // Back-date the expiry directly, rather than waiting an hour.
    const { getDatabase } = await import("../db/client.js");
    const { eq } = await import("drizzle-orm");
    const { drizzle: db, schema, dialect } = await getDatabase();
    const past = dialect === "pg" ? new Date(0) : 0;
    await db
      .update(schema.customers)
      .set({ passwordResetExpiresAt: past })
      .where(eq(schema.customers.email, email));

    const { agent, csrf } = await bootstrap();
    const response = await agent
      .post("/api/account/password/reset")
      .set("x-csrf-token", csrf)
      .send({ token, password: "a-brand-new-long-password" })
      .expect(410);

    expect(response.body.error).toMatch(/expired/i);
  });

  it("answers identically for a known and an unknown email", async () => {
    const { createCustomer } = await import("./auth.js");
    await createCustomer("has-account@example.com", PASSWORD, null);

    const known = await bootstrap();
    const knownResponse = await known.agent
      .post("/api/account/password/forgot")
      .set("x-csrf-token", known.csrf)
      .send({ email: "has-account@example.com" });

    const unknown = await bootstrap();
    const unknownResponse = await unknown.agent
      .post("/api/account/password/forgot")
      .set("x-csrf-token", unknown.csrf)
      .send({ email: "no-such-account@example.com" });

    expect(knownResponse.status).toBe(204);
    expect(unknownResponse.status).toBe(204);
    expect(knownResponse.body).toEqual(unknownResponse.body);
  });

  // See the equivalent test under "registration and verification" for why
  // this proves the property instead of timing it.
  it("answers before the reset email finishes sending", async () => {
    const { sendAccountEmail } = await import("./email.js");
    let release: (sent: boolean) => void = () => {};
    vi.mocked(sendAccountEmail).mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );

    const email = "slow-smtp-reset@example.com";
    const { createCustomer } = await import("./auth.js");
    await createCustomer(email, PASSWORD, null);

    const { agent, csrf } = await bootstrap();
    await agent
      .post("/api/account/password/forgot")
      .set("x-csrf-token", csrf)
      .send({ email })
      .expect(204);

    release(true);
  });
});

describe("login", () => {
  it("rejects an unknown account with the same status and message as a wrong password", async () => {
    const email = "known-login@example.com";
    const { createCustomer } = await import("./auth.js");
    await createCustomer(email, PASSWORD, null);

    const wrongPassword = await bootstrap();
    const a = await wrongPassword.agent
      .post("/api/account/session")
      .set("x-csrf-token", wrongPassword.csrf)
      .send({ email, password: "not-the-password" })
      .expect(401);

    const unknownAccount = await bootstrap();
    const b = await unknownAccount.agent
      .post("/api/account/session")
      .set("x-csrf-token", unknownAccount.csrf)
      .send({ email: "never-registered@example.com", password: "not-the-password" })
      .expect(401);

    expect(a.body.error).toBe(b.body.error);
  });
});
