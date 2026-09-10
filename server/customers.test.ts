import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type * as EmailModule from "./email.js";

/**
 * Customer accounts: the verification gate, the IDOR, and enumeration.
 *
 * Every `/register` and `/password/forgot` call in this file shares one
 * `emailRateLimit` bucket (10 per 15 minutes, keyed by IP) for the lifetime
 * of `app` — keep the running total across this file's tests at or under 10.
 */

vi.mock("./email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof EmailModule>()),
  sendAccountEmail: vi.fn(),
}));

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
  const rows = (await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.email, email)).limit(1)) as unknown as { id: string }[];
  return rows[0]!.id;
}

async function pendingOrder(email: string, customerId: string | null = null) {
  const { createPendingOrder } = await import("../db/orders-repository.js");
  const orderId = randomUUID();
  await createPendingOrder({ id: orderId, checkoutSessionId: `cs_test_${orderId}`, email, currency: "USD", unitPriceCents: 140, lines: [], customerId });
  return orderId;
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");
  await runMigrations();
  await seedIfEmpty();
  app = createApp();
});

describe("registration and verification", () => {
  it("does not link orders until the email is verified, then links them", async () => {
    const email = "claiming@example.com";
    const orderId = await pendingOrder(email);
    const { getOrderCustomerId } = await import("../db/orders-repository.js");

    const { agent, csrf } = await bootstrap();
    await agent.post("/api/account/register").set("x-csrf-token", csrf).send({ email, password: PASSWORD }).expect(204);
    expect(await getOrderCustomerId(orderId)).toBeNull();

    const { createEmailVerificationToken } = await import("./auth.js");
    const customerId = await customerIdForEmail(email);
    const token = await createEmailVerificationToken(customerId);

    const verified = await agent.post("/api/account/verify").set("x-csrf-token", csrf).send({ token }).expect(200);
    expect(verified.body.csrfToken).toBeTruthy();
    expect(await getOrderCustomerId(orderId)).toBe(customerId);

    const orders = await agent.get("/api/account/orders").expect(200);
    expect((orders.body as { id: string }[]).some((o) => o.id === orderId)).toBe(true);
  });

  it("does not create a second account, change the password, or send a `next` for a taken email", async () => {
    const email = "taken@example.com";
    const first = await bootstrap();
    await first.agent.post("/api/account/register").set("x-csrf-token", first.csrf).send({ email, password: PASSWORD }).expect(204);

    const { sendAccountEmail } = vi.mocked(await import("./email.js"));
    sendAccountEmail.mockClear();

    const second = await bootstrap();
    const response = await second.agent
      .post("/api/account/register")
      .set("x-csrf-token", second.csrf)
      .send({ email, password: "a-totally-different-password", next: "/cart" })
      .expect(204);
    expect(response.body).toEqual({});
    expect(sendAccountEmail).not.toHaveBeenCalled();

    const third = await bootstrap();
    await third.agent.post("/api/account/session").set("x-csrf-token", third.csrf).send({ email, password: PASSWORD }).expect(200);
  });
});

describe("carrying `next` through registration", () => {
  it("puts a same-site `next` on the verification link for a new email", async () => {
    const { sendAccountEmail } = vi.mocked(await import("./email.js"));
    sendAccountEmail.mockClear();

    const { agent, csrf } = await bootstrap();
    await agent
      .post("/api/account/register")
      .set("x-csrf-token", csrf)
      .send({ email: "cart-return@example.com", password: PASSWORD, next: "/cart" })
      .expect(204);

    expect(sendAccountEmail).toHaveBeenCalledTimes(1);
    const [, , verifyUrl] = sendAccountEmail.mock.calls[0]!;
    expect(new URL(verifyUrl).searchParams.get("next")).toBe("/cart");
  });

  it("drops an off-site `next` rather than sending it", async () => {
    const { sendAccountEmail } = vi.mocked(await import("./email.js"));
    sendAccountEmail.mockClear();

    const { agent, csrf } = await bootstrap();
    await agent
      .post("/api/account/register")
      .set("x-csrf-token", csrf)
      .send({ email: "offsite-next@example.com", password: PASSWORD, next: "https://evil.example" })
      .expect(204);

    const [, , verifyUrl] = sendAccountEmail.mock.calls[0]!;
    expect(new URL(verifyUrl).searchParams.has("next")).toBe(false);
  });
});

describe("order access", () => {
  async function registeredAndVerified(email: string) {
    const { agent, csrf } = await bootstrap();
    await agent.post("/api/account/register").set("x-csrf-token", csrf).send({ email, password: PASSWORD }).expect(204);
    const { createEmailVerificationToken } = await import("./auth.js");
    const customerId = await customerIdForEmail(email);
    const token = await createEmailVerificationToken(customerId);
    const verified = await agent.post("/api/account/verify").set("x-csrf-token", csrf).send({ token }).expect(200);
    return { agent, csrf: verified.body.csrfToken as string, customerId };
  }

  it("404s another customer's order rather than exposing it", async () => {
    const owner = await registeredAndVerified("owner-of-order@example.com");
    const stranger = await registeredAndVerified("stranger@example.com");
    const orderId = await pendingOrder("owner-of-order@example.com", owner.customerId);

    await owner.agent.get(`/api/account/orders/${orderId}`).expect(200);
    await stranger.agent.get(`/api/account/orders/${orderId}`).expect(404);
  });

  it("saves and lists recipients, refusing one Lob could not print", async () => {
    const { agent, csrf } = await registeredAndVerified("recipients@example.com");

    const created = await agent
      .post("/api/account/addresses")
      .set("x-csrf-token", csrf)
      .send({ name: "Grandma", line1: "1 Test St", line2: null, city: "Marfa", state: "tx", postalCode: "79843", country: "US" })
      .expect(201);
    expect(created.body.state).toBe("TX");

    await agent
      .post("/api/account/addresses")
      .set("x-csrf-token", csrf)
      .send({ name: "Grandma", line1: "1 Test St", line2: null, city: "Marfa", state: "Texas", postalCode: "79843", country: "US" })
      .expect(400);

    const list = await agent.get("/api/account/addresses").expect(200);
    expect(list.body).toHaveLength(1);
  });
});

describe("password reset", () => {
  it("is single-use and rejects a second attempt", async () => {
    const email = "resetter@example.com";
    const { createCustomer, createPasswordResetToken } = await import("./auth.js");
    await createCustomer(email, PASSWORD, null);
    const token = await createPasswordResetToken(email);

    const { agent, csrf } = await bootstrap();
    await agent.post("/api/account/password/reset").set("x-csrf-token", csrf).send({ token, password: "a-brand-new-long-password" }).expect(204);

    const replay = await bootstrap();
    await replay.agent.post("/api/account/password/reset").set("x-csrf-token", replay.csrf).send({ token, password: "yet-another-long-password" }).expect(410);
  });

  it("answers identically for a known and an unknown email", async () => {
    const { createCustomer } = await import("./auth.js");
    await createCustomer("has-account@example.com", PASSWORD, null);

    const known = await bootstrap();
    const knownResponse = await known.agent.post("/api/account/password/forgot").set("x-csrf-token", known.csrf).send({ email: "has-account@example.com" });
    const unknown = await bootstrap();
    const unknownResponse = await unknown.agent.post("/api/account/password/forgot").set("x-csrf-token", unknown.csrf).send({ email: "no-such-account@example.com" });

    expect(knownResponse.status).toBe(204);
    expect(unknownResponse.status).toBe(204);
    expect(knownResponse.body).toEqual(unknownResponse.body);
  });
});
