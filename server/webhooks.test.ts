import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Outbound webhooks — the parts that need the SSRF guard switched on, which is
 * its default. The delivery loop lives in server/webhook-delivery.test.ts,
 * because exercising it against a real receiver means allowing a loopback
 * target, and that is exactly the setting this file needs left alone.
 *
 * See docs/tasks/14-outbound-webhooks.md.
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

async function signIn() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);

  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email: "hooks-admin@example.com", password: PASSWORD })
    .expect(200);

  return { agent, csrf: login.body.csrfToken as string };
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("hooks-admin@example.com", PASSWORD);

  app = createApp();
});

describe("the SSRF guard", () => {
  it("classifies the addresses an endpoint must never reach", async () => {
    const { isPrivateAddress } = await import("./webhooks.js");

    // The one the brief names: EC2/GCP instance metadata.
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("0.0.0.0")).toBe(true);
    expect(isPrivateAddress("255.255.255.255")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);

    // The v6 wrappers around a v4 address: what is actually reached is the
    // v4 address, so that is what has to be judged.
    expect(isPrivateAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateAddress("64:ff9b::127.0.0.1")).toBe(true);

    // Anything unparseable is refused rather than guessed at.
    expect(isPrivateAddress("not-an-address")).toBe(true);

    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);

    // 172.x is only private in the middle of the range.
    expect(isPrivateAddress("172.15.0.1")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
  });

  it("refuses an endpoint pointed at the metadata address", async () => {
    const { agent, csrf } = await signIn();

    const response = await agent
      .post("/api/admin/webhooks")
      .set("x-csrf-token", csrf)
      .send({
        url: "https://169.254.169.254/latest/meta-data/",
        eventTypes: ["order.paid"],
      })
      .expect(422);

    expect(response.body.error).toMatch(/private or reserved/i);

    // And nothing was stored: a rejected endpoint must not be half-created.
    const list = await agent.get("/api/admin/webhooks").expect(200);
    expect(list.body.endpoints).toHaveLength(0);
  });

  it("refuses a loopback host and plain http while the opt-out is off", async () => {
    const { agent, csrf } = await signIn();

    await agent
      .post("/api/admin/webhooks")
      .set("x-csrf-token", csrf)
      .send({ url: "https://127.0.0.1:9999/hook", eventTypes: ["order.paid"] })
      .expect(422);

    const insecure = await agent
      .post("/api/admin/webhooks")
      .set("x-csrf-token", csrf)
      .send({ url: "http://example.com/hook", eventTypes: ["order.paid"] })
      .expect(422);

    expect(insecure.body.error).toMatch(/https/i);
  });

  it("refuses a hostname that resolves to a private address, not just a literal one", async () => {
    const { assertDeliverableUrl, EndpointNotAllowedError } = await import("./webhooks.js");

    // localhost is the string-level check's blind spot: it looks like an
    // ordinary hostname and resolves to 127.0.0.1.
    await expect(assertDeliverableUrl("https://localhost/hook")).rejects.toBeInstanceOf(
      EndpointNotAllowedError,
    );
  });
});

describe("signing", () => {
  it("produces Stripe's header shape over the timestamp and the body", async () => {
    const { signPayload } = await import("./webhooks.js");
    const { createHmac } = await import("node:crypto");

    const body = JSON.stringify({ id: "evt_1", type: "order.paid" });
    const header = signPayload("bwhsec_test", body, 1_700_000_000);

    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);

    /*
     * The verification snippet the README hands merchants, run against a real
     * signature. If this assertion is edited, the README section has to change
     * with it — that is the point of testing the documented recipe rather than
     * the implementation's own inverse.
     */
    const [timestampPart, signaturePart] = header.split(",");
    const timestamp = timestampPart!.slice(2);
    const provided = signaturePart!.slice(3);
    const expected = createHmac("sha256", "bwhsec_test")
      .update(`${timestamp}.${body}`)
      .digest("hex");

    expect(provided).toBe(expected);
  });

  it("signs the timestamp too, so a replayed body cannot be re-stamped", async () => {
    const { signPayload } = await import("./webhooks.js");

    const body = JSON.stringify({ id: "evt_1" });
    const original = signPayload("bwhsec_test", body, 1_700_000_000);
    const restamped = signPayload("bwhsec_test", body, 1_700_003_600);

    // Same bytes, different minute, different signature — which is what lets a
    // subscriber reject anything older than its own tolerance.
    expect(original.split("v1=")[1]).not.toBe(restamped.split("v1=")[1]);
  });
});

describe("the signing secret", () => {
  it("is returned once at creation and never by a read", async () => {
    const { agent, csrf } = await signIn();

    const created = await agent
      .post("/api/admin/webhooks")
      .set("x-csrf-token", csrf)
      .send({
        url: "https://example.com/hooks/orders",
        description: "Fulfilment",
        eventTypes: ["order.paid", "order.updated"],
      })
      .expect(201);

    const secret = created.body.secret as string;
    expect(secret).toMatch(/^bwhsec_/);
    expect(created.body.endpoint.secret).toBeUndefined();

    const list = await agent.get("/api/admin/webhooks").expect(200);
    const endpoints = list.body.endpoints as { id: string; secret?: string }[];
    const found = endpoints.find((e) => e.id === (created.body.endpoint.id as string));

    expect(found).toBeDefined();
    expect(found!.secret).toBeUndefined();
    expect(JSON.stringify(list.body)).not.toContain(secret);

    // Rolling is the only way back from a lost secret, and it mints a new one.
    const rolled = await agent
      .post(`/api/admin/webhooks/${created.body.endpoint.id}/secret`)
      .set("x-csrf-token", csrf)
      .expect(200);

    expect(rolled.body.secret).toMatch(/^bwhsec_/);
    expect(rolled.body.secret).not.toBe(secret);
  });
});

describe("the payload", () => {
  it("carries the order and none of the store's secrets", async () => {
    const { emitOrderEvent } = await import("./webhooks.js");
    const { createPendingOrder, getOrder, markOrderPaid } = await import(
      "../db/orders-repository.js"
    );
    const { createEndpoint, listDeliveries } = await import("../db/webhooks-repository.js");
    const { env } = await import("./env.js");

    const endpoint = await createEndpoint({
      url: "https://example.com/hooks/redaction",
      description: "",
      eventTypes: ["order.paid"],
      enabled: true,
      secret: "bwhsec_redaction_probe",
    });

    const orderId = randomUUID();
    await createPendingOrder({
      id: orderId,
      checkoutSessionId: `cs_test_${orderId}`,
      email: "buyer@example.com",
      currency: "USD",
      subtotalCents: 3400,
      lines: [
        {
          productId: "demo-tote",
          variantId: "demo-tote-s",
          productName: "Demo Tote",
          variantLabel: "Small",
          unitPriceCents: 3400,
          quantity: 1,
          options: {},
        },
      ],
    });

    await markOrderPaid(orderId, {
      paymentIntentId: "pi_secret_should_not_travel",
      email: "buyer@example.com",
      subtotalCents: 3400,
      shippingCents: 0,
      taxCents: 0,
      discountCents: 0,
      totalCents: 3400,
      currency: "USD",
      shipping: {
        name: "A Buyer",
        line1: "1 Test Street",
        line2: null,
        city: "Marfa",
        state: "TX",
        postalCode: "79843",
        country: "US",
      },
    });

    const order = await getOrder(orderId);
    await emitOrderEvent("order.paid", order!);

    const [delivery] = await listDeliveries(endpoint.id, 10);
    expect(delivery).toBeDefined();

    const body = JSON.stringify(delivery!.payload);

    // What a subscriber needs.
    expect(delivery!.payload.type).toBe("order.paid");
    expect(body).toContain(order!.reference);
    expect(body).toContain("Demo Tote");

    // What must never be in it.
    expect(body).not.toContain(env.STRIPE_SECRET_KEY);
    expect(body).not.toContain(env.STRIPE_WEBHOOK_SECRET);
    expect(body).not.toContain(env.SESSION_SECRET);
    expect(body).not.toContain("pi_secret_should_not_travel");
    expect(body).not.toContain("$argon2");
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("csrfToken");
  });

  it("goes only to endpoints subscribed to that event type", async () => {
    const { emitWebhookEvent } = await import("./webhooks.js");
    const { createEndpoint, listDeliveries } = await import("../db/webhooks-repository.js");

    const subscribed = await createEndpoint({
      url: "https://example.com/hooks/inventory",
      description: "",
      eventTypes: ["inventory.low"],
      enabled: true,
      secret: "bwhsec_subscribed",
    });

    const disabled = await createEndpoint({
      url: "https://example.com/hooks/off",
      description: "",
      eventTypes: ["inventory.low"],
      enabled: false,
      secret: "bwhsec_disabled",
    });

    const unrelated = await createEndpoint({
      url: "https://example.com/hooks/products",
      description: "",
      eventTypes: ["product.published"],
      enabled: true,
      secret: "bwhsec_unrelated",
    });

    await emitWebhookEvent("inventory.low", { variantId: "demo-tote-s", remaining: 2 });

    expect(await listDeliveries(subscribed.id, 10)).toHaveLength(1);
    expect(await listDeliveries(disabled.id, 10)).toHaveLength(0);
    expect(await listDeliveries(unrelated.id, 10)).toHaveLength(0);
  });

  it("gives every subscriber of one event the same event id", async () => {
    const { emitWebhookEvent } = await import("./webhooks.js");
    const { createEndpoint, listDeliveries } = await import("../db/webhooks-repository.js");

    const first = await createEndpoint({
      url: "https://example.com/hooks/one",
      description: "",
      eventTypes: ["product.published"],
      enabled: true,
      secret: "bwhsec_one",
    });
    const second = await createEndpoint({
      url: "https://example.com/hooks/two",
      description: "",
      eventTypes: ["product.published"],
      enabled: true,
      secret: "bwhsec_two",
    });

    await emitWebhookEvent("product.published", { id: "demo-tote" });

    const [a] = await listDeliveries(first.id, 10);
    const [b] = await listDeliveries(second.id, 10);

    expect(a!.eventId).toBe(b!.eventId);
    expect(a!.id).not.toBe(b!.id);
  });
});
