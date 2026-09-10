import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import sharp from "sharp";
import type * as EmailModule from "./email.js";
import { todayIso } from "../shared/postcards.js";

/**
 * Abandoned cart recovery, exercised directly against the repository and
 * orchestration functions.
 */

vi.mock("./email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof EmailModule>()),
  sendCartRecoveryEmail: vi.fn(),
}));

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";
const RECIPIENT = { name: "Grandma", line1: "1 Test Street", line2: null, city: "Marfa", state: "TX", postalCode: "79843" };

async function bootstrap() {
  const agent = request.agent(app);
  const session = await agent.get("/api/session").expect(200);
  return { agent, csrf: session.body.csrfToken as string };
}

async function signInCustomer(email: string, password: string) {
  const { agent, csrf: initialCsrf } = await bootstrap();
  const login = await agent.post("/api/account/session").set("x-csrf-token", initialCsrf).send({ email, password }).expect(200);
  return { agent, csrf: login.body.csrfToken as string };
}

function timestampValue(dialect: string, date: Date): Date | number {
  return dialect === "pg" ? date : Math.floor(date.getTime() / 1000);
}

async function markVerified(customerId: string): Promise<void> {
  const { getDatabase } = await import("../db/client.js");
  const { eq } = await import("drizzle-orm");
  const { drizzle: db, schema, dialect } = await getDatabase();
  await db.update(schema.customers).set({ emailVerifiedAt: timestampValue(dialect, new Date()) }).where(eq(schema.customers.id, customerId));
}

async function backdateCart(customerId: string, hoursAgo: number): Promise<void> {
  const { getDatabase } = await import("../db/client.js");
  const { eq } = await import("drizzle-orm");
  const { drizzle: db, schema, dialect } = await getDatabase();
  const when = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  await db.update(schema.carts).set({ updatedAt: timestampValue(dialect, when) }).where(eq(schema.carts.customerId, customerId));
}

async function enableCartRecovery(delayHours = 1): Promise<void> {
  const { getDatabase } = await import("../db/client.js");
  const { eq } = await import("drizzle-orm");
  const { drizzle: db, schema } = await getDatabase();
  await db.update(schema.storeSettings).set({ cartRecoveryEnabled: true, cartRecoveryDelayHours: delayHours }).where(eq(schema.storeSettings.id, 1));
}

let uniq = 0;
function freshEmail(): string {
  uniq += 1;
  return `cart-recovery-${uniq}-${randomUUID()}@example.com`;
}

async function line() {
  const png = await sharp({ create: { width: 100, height: 150, channels: 3, background: "#123456" } }).png().toBuffer();
  const uploaded = await request(app).post("/api/designs").field("orientation", "portrait").attach("file", png, { filename: "a.png", contentType: "image/png" }).expect(201);
  return { designs: [{ designId: uploaded.body.id as string, mailDate: todayIso() }], recipients: [RECIPIENT] };
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
    await request(app).post("/api/cart/sync").send({ lines: [] }).expect(403);
  });

  it("rejects a sync from a valid session that never signed in", async () => {
    const { agent, csrf } = await bootstrap();
    await agent.post("/api/cart/sync").set("x-csrf-token", csrf).send({ lines: [] }).expect(401);
  });

  it("persists a signed-in customer's cart, and clears it when emptied", async () => {
    const email = freshEmail();
    const { createCustomer } = await import("./auth.js");
    const customerId = await createCustomer(email, PASSWORD, null);
    await markVerified(customerId);

    const { agent, csrf } = await signInCustomer(email, PASSWORD);
    await agent.post("/api/cart/sync").set("x-csrf-token", csrf).send({ lines: [await line()] }).expect(204);

    const { findCartsDueForReminder } = await import("../db/carts-repository.js");
    await backdateCart(customerId, 2);
    expect((await findCartsDueForReminder(new Date(), 50)).some((c) => c.customerId === customerId)).toBe(true);

    await agent.post("/api/cart/sync").set("x-csrf-token", csrf).send({ lines: [] }).expect(204);
    expect((await findCartsDueForReminder(new Date(), 50)).some((c) => c.customerId === customerId)).toBe(false);
  });
});

describe("the sweep", () => {
  it("sends exactly one reminder even when claimed twice", async () => {
    const { upsertActiveCart, claimReminder } = await import("../db/carts-repository.js");
    const { createCustomer, hashToken } = await import("./auth.js");

    const email = freshEmail();
    const customerId = await createCustomer(email, PASSWORD, null);
    await markVerified(customerId);
    const cart = await upsertActiveCart(customerId, email, "USD", [await line()]);

    const [first, second] = await Promise.all([claimReminder(cart!.id, hashToken("a")), claimReminder(cart!.id, hashToken("b"))]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("prices the reminder from settings and drops a cleaned-up design", async () => {
    const { upsertActiveCart } = await import("../db/carts-repository.js");
    const { createCustomer } = await import("./auth.js");
    const { runCartRecoverySweep } = await import("./cart-recovery.js");
    const { sendCartRecoveryEmail } = await import("./email.js");

    const email = freshEmail();
    const customerId = await createCustomer(email, PASSWORD, null);
    await markVerified(customerId);
    const real = await line();
    await upsertActiveCart(customerId, email, "USD", [
      real,
      { designs: [{ designId: "gone", mailDate: todayIso() }], recipients: [RECIPIENT] },
    ]);
    await backdateCart(customerId, 5);

    vi.mocked(sendCartRecoveryEmail).mockClear();
    await runCartRecoverySweep();

    const call = vi.mocked(sendCartRecoveryEmail).mock.calls.find(([to]) => to === email);
    expect(call).toBeDefined();
    const locals = call![1];
    expect(locals.items).toHaveLength(1);
    expect(locals.items[0]?.count).toBe(1);
    expect(locals.subtotal).toBe("$1.40");
    expect(locals.droppedCount).toBe(1);
  });
});

describe("recovery link", () => {
  it("is single-use, rejects a second redemption, and returns the lines", async () => {
    const { upsertActiveCart, claimReminder } = await import("../db/carts-repository.js");
    const { createCustomer, hashToken } = await import("./auth.js");
    const { recoverCart, CartTokenNotUsableError } = await import("./cart-recovery.js");

    const email = freshEmail();
    const customerId = await createCustomer(email, PASSWORD, null);
    await markVerified(customerId);
    const stored = await line();
    const cart = await upsertActiveCart(customerId, email, "USD", [stored]);

    const token = "a-raw-recovery-token-for-testing";
    await claimReminder(cart!.id, hashToken(token));

    expect(await recoverCart(token)).toEqual([stored]);
    await expect(recoverCart(token)).rejects.toBeInstanceOf(CartTokenNotUsableError);
  });
});

describe("checkout.session.expired salvage", () => {
  it("rebuilds the cart batch by batch and reminds a verified customer", async () => {
    const { createCustomer } = await import("./auth.js");
    const { createPendingOrder, getOrder } = await import("../db/orders-repository.js");
    const { notifyCheckoutExpired, linesFromOrder } = await import("./cart-recovery.js");
    const { findCartsDueForReminder } = await import("../db/carts-repository.js");

    const email = freshEmail();
    const customerId = await createCustomer(email, PASSWORD, null);
    await markVerified(customerId);

    const first = await line();
    const second = await line();
    const orderId = randomUUID();
    await createPendingOrder({
      id: orderId,
      checkoutSessionId: `cs_test_${orderId}`,
      email,
      currency: "USD",
      unitPriceCents: 140,
      lines: [first, { ...second, recipients: [RECIPIENT, { ...RECIPIENT, name: "Grandpa" }] }],
      customerId,
    });

    const order = (await getOrder(orderId))!;
    expect(linesFromOrder(order)).toEqual([first, { ...second, recipients: [RECIPIENT, { ...RECIPIENT, name: "Grandpa" }] }]);

    await notifyCheckoutExpired(customerId, order);

    await backdateCart(customerId, 5);
    expect((await findCartsDueForReminder(new Date(), 100)).some((c) => c.customerId === customerId)).toBe(false);
  });
});
