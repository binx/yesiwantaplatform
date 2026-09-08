import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Abandoned cart recovery — docs/tasks/12-abandoned-cart.md's acceptance list,
 * exercised directly against the repository/orchestration functions rather
 * than through Stripe's webhook signing (covered elsewhere for the payment
 * paths; simulating a signed event here would test the signature verifier,
 * not this feature).
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

async function bootstrap() {
  const agent = request.agent(app);
  const session = await agent.get("/api/session").expect(200);
  return { agent, csrf: session.body.csrfToken as string };
}

/** Signed in as a customer, with the *post-login* CSRF token — login regenerates the session. */
async function signInCustomer(email: string, password: string) {
  const { agent, csrf: initialCsrf } = await bootstrap();
  const login = await agent
    .post("/api/account/session")
    .set("x-csrf-token", initialCsrf)
    .send({ email, password })
    .expect(200);

  return { agent, csrf: login.body.csrfToken as string };
}

/** SQLite's timestamp columns are plain integers — a bound `Date` throws. */
function timestampValue(dialect: string, date: Date): Date | number {
  return dialect === "pg" ? date : Math.floor(date.getTime() / 1000);
}

async function markVerified(customerId: string): Promise<void> {
  const { getDatabase } = await import("../db/client.js");
  const { eq } = await import("drizzle-orm");
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db
    .update(schema.customers)
    .set({ emailVerifiedAt: timestampValue(dialect, new Date()) })
    .where(eq(schema.customers.id, customerId));
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

/** Backdate a cart's `updatedAt` so the sweep sees it as idle, without waiting. */
async function backdateCart(customerId: string, hoursAgo: number): Promise<void> {
  const { getDatabase } = await import("../db/client.js");
  const { eq } = await import("drizzle-orm");
  const { drizzle: db, schema, dialect } = await getDatabase();
  const when = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  await db
    .update(schema.carts)
    .set({ updatedAt: timestampValue(dialect, when) })
    .where(eq(schema.carts.customerId, customerId));
}

async function enableCartRecovery(delayHours = 1): Promise<void> {
  const { getDatabase } = await import("../db/client.js");
  const { eq } = await import("drizzle-orm");
  const { drizzle: db, schema } = await getDatabase();
  await db
    .update(schema.storeSettings)
    .set({ cartRecoveryEnabled: true, cartRecoveryDelayHours: delayHours })
    .where(eq(schema.storeSettings.id, 1));
}

let uniq = 0;
function freshEmail(): string {
  uniq += 1;
  return `cart-recovery-${uniq}-${randomUUID()}@example.com`;
}

/** A demo product's id/variantId, seeded by `seedIfEmpty`. */
async function demoLine() {
  const { getDatabase } = await import("../db/client.js");
  const { drizzle: db, schema } = await getDatabase();
  const products = (await db.select().from(schema.products).limit(1)) as unknown as { id: string }[];
  const variants = (await db
    .select()
    .from(schema.variants)) as unknown as { id: string; productId: string }[];
  const productId = products[0]!.id;
  const variant = variants.find((v) => v.productId === productId)!;
  return { productId, variantId: variant.id, quantity: 1, options: {} };
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await enableCartRecovery();

  app = createApp();
});

describe("cart sync", () => {
  it("rejects a sync with no CSRF token at all", async () => {
    // No token, no session: the router-wide CSRF check (same order as
    // accountRouter's) rejects this before `requireCustomer` is ever reached.
    await request(app).post("/api/cart/sync").send({ lines: [] }).expect(403);
  });

  it("rejects a sync from a valid session that never signed in", async () => {
    const { agent, csrf } = await bootstrap();
    await agent.post("/api/cart/sync").set("x-csrf-token", csrf).send({ lines: [] }).expect(401);
  });

  it("persists a signed-in customer's cart, and clears it when emptied", async () => {
    const email = freshEmail();
    const { createCustomer } = await import("./auth.js");
    await createCustomer(email, PASSWORD, null);
    const customerId = await customerIdForEmail(email);
    await markVerified(customerId);

    const { agent, csrf } = await signInCustomer(email, PASSWORD);

    const line = await demoLine();
    await agent.post("/api/cart/sync").set("x-csrf-token", csrf).send({ lines: [line] }).expect(204);

    const { findCartsDueForReminder } = await import("../db/carts-repository.js");
    await backdateCart(customerId, 2);
    const due = await findCartsDueForReminder(new Date(), 50);
    expect(due.some((c) => c.customerId === customerId)).toBe(true);

    // Emptying the cart deletes the row rather than storing an empty one.
    await agent.post("/api/cart/sync").set("x-csrf-token", csrf).send({ lines: [] }).expect(204);
    const dueAfterEmpty = await findCartsDueForReminder(new Date(), 50);
    expect(dueAfterEmpty.some((c) => c.customerId === customerId)).toBe(false);
  });
});

describe("the sweep", () => {
  it("does nothing while the feature is off", async () => {
    const { getDatabase } = await import("../db/client.js");
    const { eq } = await import("drizzle-orm");
    const { drizzle: db, schema } = await getDatabase();

    const email = freshEmail();
    const { createCustomer } = await import("./auth.js");
    const customerId = await createCustomer(email, PASSWORD, null);
    await markVerified(customerId);

    const { upsertActiveCart } = await import("../db/carts-repository.js");
    await upsertActiveCart(customerId, email, "USD", [await demoLine()]);
    await backdateCart(customerId, 5);

    await db.update(schema.storeSettings).set({ cartRecoveryEnabled: false }).where(eq(schema.storeSettings.id, 1));

    const { runCartRecoverySweep } = await import("./cart-recovery.js");
    await runCartRecoverySweep();

    const rows = (await db
      .select({ reminderSentAt: schema.carts.reminderSentAt })
      .from(schema.carts)
      .where(eq(schema.carts.customerId, customerId))) as unknown as { reminderSentAt: unknown }[];
    expect(rows[0]?.reminderSentAt).toBeFalsy();

    await enableCartRecovery();
  });

  it("skips an unverified customer and one who has opted out", async () => {
    const { upsertActiveCart, findCartsDueForReminder } = await import("../db/carts-repository.js");
    const { createCustomer } = await import("./auth.js");

    const unverifiedEmail = freshEmail();
    const unverifiedId = await createCustomer(unverifiedEmail, PASSWORD, null);
    await upsertActiveCart(unverifiedId, unverifiedEmail, "USD", [await demoLine()]);
    await backdateCart(unverifiedId, 5);

    const optedOutEmail = freshEmail();
    const optedOutId = await createCustomer(optedOutEmail, PASSWORD, null);
    await markVerified(optedOutId);
    await upsertActiveCart(optedOutId, optedOutEmail, "USD", [await demoLine()]);
    await backdateCart(optedOutId, 5);

    const { getDatabase } = await import("../db/client.js");
    const { eq } = await import("drizzle-orm");
    const { drizzle: db, schema, dialect } = await getDatabase();
    await db
      .update(schema.customers)
      .set({ cartRecoveryOptOutAt: timestampValue(dialect, new Date()) })
      .where(eq(schema.customers.id, optedOutId));

    const due = await findCartsDueForReminder(new Date(), 100);
    expect(due.some((c) => c.customerId === unverifiedId)).toBe(false);
    expect(due.some((c) => c.customerId === optedOutId)).toBe(false);
  });

  it("sends exactly one reminder even when claimed twice (the two-instance case)", async () => {
    const { upsertActiveCart, claimReminder } = await import("../db/carts-repository.js");
    const { createCustomer } = await import("./auth.js");
    const { hashToken } = await import("./auth.js");

    const email = freshEmail();
    const customerId = await createCustomer(email, PASSWORD, null);
    await markVerified(customerId);
    const cart = await upsertActiveCart(customerId, email, "USD", [await demoLine()]);
    await backdateCart(customerId, 5);

    const [first, second] = await Promise.all([
      claimReminder(cart!.id, hashToken("token-a")),
      claimReminder(cart!.id, hashToken("token-b")),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });
});

describe("recovery link", () => {
  it("is single-use and rejects a second redemption", async () => {
    const { upsertActiveCart, claimReminder } = await import("../db/carts-repository.js");
    const { createCustomer, hashToken } = await import("./auth.js");
    const { recoverCart, CartTokenNotUsableError } = await import("./cart-recovery.js");

    const email = freshEmail();
    const customerId = await createCustomer(email, PASSWORD, null);
    await markVerified(customerId);
    const line = await demoLine();
    const cart = await upsertActiveCart(customerId, email, "USD", [line]);

    const token = "a-raw-recovery-token-for-testing";
    await claimReminder(cart!.id, hashToken(token));

    const lines = await recoverCart(token);
    expect(lines).toEqual([line]);

    await expect(recoverCart(token)).rejects.toBeInstanceOf(CartTokenNotUsableError);
  });

  it("rejects an unknown token", async () => {
    const { recoverCart, CartTokenNotUsableError } = await import("./cart-recovery.js");
    await expect(recoverCart("not-a-real-token")).rejects.toBeInstanceOf(CartTokenNotUsableError);
  });

  it("is reachable over HTTP and repopulates via the recover endpoint", async () => {
    const { upsertActiveCart, claimReminder } = await import("../db/carts-repository.js");
    const { createCustomer, hashToken } = await import("./auth.js");

    const email = freshEmail();
    const customerId = await createCustomer(email, PASSWORD, null);
    await markVerified(customerId);
    const line = await demoLine();
    const cart = await upsertActiveCart(customerId, email, "USD", [line]);
    const token = "another-raw-recovery-token";
    await claimReminder(cart!.id, hashToken(token));

    const { agent, csrf } = await bootstrap();
    const response = await agent
      .post("/api/cart/recover")
      .set("x-csrf-token", csrf)
      .send({ token })
      .expect(200);

    expect(response.body.lines).toEqual([line]);

    await agent.post("/api/cart/recover").set("x-csrf-token", csrf).send({ token }).expect(410);
  });
});

describe("unsubscribe", () => {
  it("is idempotent and stops the customer from being selected again", async () => {
    const { upsertActiveCart, findCartsDueForReminder } = await import("../db/carts-repository.js");
    const { createCustomer } = await import("./auth.js");
    const { setCartRecoveryUnsubscribeTokenHash } = await import("../db/customers-repository.js");
    const { unsubscribeFromCartRecovery } = await import("./cart-recovery.js");
    const { hashToken } = await import("./auth.js");

    const email = freshEmail();
    const customerId = await createCustomer(email, PASSWORD, null);
    await markVerified(customerId);
    await upsertActiveCart(customerId, email, "USD", [await demoLine()]);
    await backdateCart(customerId, 5);

    const token = "an-unsubscribe-token";
    await setCartRecoveryUnsubscribeTokenHash(customerId, hashToken(token));

    await unsubscribeFromCartRecovery(token);
    await unsubscribeFromCartRecovery(token); // idempotent

    const due = await findCartsDueForReminder(new Date(), 100);
    expect(due.some((c) => c.customerId === customerId)).toBe(false);
  });
});

describe("checkout.session.expired salvage", () => {
  it("sends an immediate reminder for a verified, signed-in customer's expired checkout", async () => {
    const { createCustomer } = await import("./auth.js");
    const { createPendingOrder, getOrder } = await import("../db/orders-repository.js");
    const { notifyCheckoutExpired } = await import("./cart-recovery.js");
    const { findCartsDueForReminder } = await import("../db/carts-repository.js");

    const email = freshEmail();
    const customerId = await createCustomer(email, PASSWORD, null);
    await markVerified(customerId);

    const line = await demoLine();
    const orderId = randomUUID();
    await createPendingOrder({
      id: orderId,
      checkoutSessionId: `cs_test_${orderId}`,
      email,
      currency: "USD",
      subtotalCents: 1000,
      lines: [
        {
          productId: line.productId,
          variantId: line.variantId,
          productName: "Demo",
          variantLabel: "",
          unitPriceCents: 1000,
          quantity: 1,
          options: {},
        },
      ],
      customerId,
    });

    const order = await getOrder(orderId);
    await notifyCheckoutExpired(customerId, order!);

    // Already reminded — not picked up again by the scheduled sweep.
    await backdateCart(customerId, 5);
    const due = await findCartsDueForReminder(new Date(), 100);
    expect(due.some((c) => c.customerId === customerId)).toBe(false);
  });
});
