import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";

/**
 * The order CSV export.
 *
 * The two things worth asserting here are the ones that fail silently: the
 * route resolving as `orders.csv` rather than an order id, and a product name
 * arriving as text rather than a live spreadsheet formula.
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

async function signIn() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);

  await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email: "export@example.com", password: PASSWORD })
    .expect(200);

  return agent;
}

/** An order with lines whose names are hostile to a spreadsheet. */
async function seedOrder(id: string, createdAtMs?: number) {
  const { createPendingOrder } = await import("../db/orders-repository.js");
  const { getDatabase } = await import("../db/client.js");

  await createPendingOrder({
    id,
    checkoutSessionId: `cs_${id}`,
    email: "buyer@example.com",
    currency: "USD",
    subtotalCents: 3400,
    lines: [
      {
        productId: "demo-tote",
        variantId: "demo-tote-s",
        productName: "=1+1",
        variantLabel: 'The "big", one',
        unitPriceCents: 1700,
        quantity: 2,
        options: { Gift: "Yes" },
      },
      {
        productId: "demo-mug",
        variantId: "demo-mug-default",
        productName: "Café — größe",
        variantLabel: "",
        unitPriceCents: 2200,
        quantity: 1,
        options: {},
      },
    ],
  });

  if (createdAtMs !== undefined) {
    const { drizzle: db, schema, dialect } = await getDatabase();
    await db
      .update(schema.orders)
      .set({
        createdAt: dialect === "pg" ? new Date(createdAtMs) : Math.floor(createdAtMs / 1000),
      })
      .where(eq(schema.orders.id, id));
  }
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("export@example.com", PASSWORD);

  app = createApp();
});

describe("GET /api/admin/orders.csv", () => {
  it("is served as a downloadable CSV, not matched as an order id", async () => {
    const agent = await signIn();
    const response = await agent.get("/api/admin/orders.csv").expect(200);

    expect(response.headers["content-type"]).toMatch(/text\/csv; charset=utf-8/);
    expect(response.headers["content-disposition"]).toMatch(
      /attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"/,
    );
  });

  it("starts with a BOM and the header row", async () => {
    const agent = await signIn();
    const body = (await agent.get("/api/admin/orders.csv").expect(200)).text;

    expect(body.startsWith("﻿")).toBe(true);
    expect(body.slice(1).split("\r\n")[0]).toBe(
      "order_reference,order_id,placed_at,status,email,product_name,variant_label,options," +
        "quantity,unit_price_cents,line_total_cents,order_subtotal_cents,order_shipping_cents," +
        "order_tax_cents,order_discount_cents,order_total_cents,order_refunded_cents,currency," +
        "shipping_name,shipping_line1,shipping_line2,shipping_city,shipping_state," +
        "shipping_postal_code,shipping_country,carrier,tracking_number,oversold",
    );
  });

  it("writes one row per line, sharing the order reference", async () => {
    const agent = await signIn();
    await seedOrder("csv-order-multi");

    const body = (await agent.get("/api/admin/orders.csv").expect(200)).text;
    const rows = body
      .split("\r\n")
      .filter((line) => line.includes("csv-order-multi"));

    expect(rows).toHaveLength(2);
    // Order-level fields repeat so the file pivots.
    const references = rows.map((row) => row.split(",")[0]);
    expect(references[0]).toBe(references[1]);
  });

  it("neutralises a formula and round-trips a quoted comma", async () => {
    const agent = await signIn();
    await seedOrder("csv-order-hostile");

    const body = (await agent.get("/api/admin/orders.csv").expect(200)).text;
    // Lines are ordered by item id, so take both of the order's rows rather
    // than assuming which one comes first.
    const rows = body.split("\r\n").filter((line) => line.includes("csv-order-hostile"));
    expect(rows).toHaveLength(2);

    const hostile = rows.join("\n");
    // Excel would evaluate =1+1; the apostrophe is what makes it text.
    expect(hostile).toContain("'=1+1");
    expect(hostile).toContain('"The ""big"", one"');
  });

  it("keeps non-ASCII product names intact", async () => {
    const agent = await signIn();
    await seedOrder("csv-order-unicode");

    const body = (await agent.get("/api/admin/orders.csv").expect(200)).text;
    expect(body).toContain("Café — größe");
  });

  it("bounds the export by date", async () => {
    const agent = await signIn();
    const old = Date.UTC(2020, 0, 1);
    await seedOrder("csv-order-ancient", old);

    const recent = (
      await agent.get(`/api/admin/orders.csv?from=${Date.UTC(2024, 0, 1)}`).expect(200)
    ).text;
    expect(recent).not.toContain("csv-order-ancient");

    const bounded = (
      await agent
        .get(`/api/admin/orders.csv?from=${Date.UTC(2019, 0, 1)}&to=${Date.UTC(2021, 0, 1)}`)
        .expect(200)
    ).text;
    expect(bounded).toContain("csv-order-ancient");
  });

  it("exports only the requested status", async () => {
    const agent = await signIn();
    await seedOrder("csv-order-pending-only");

    const paid = (await agent.get("/api/admin/orders.csv?status=paid").expect(200)).text;
    expect(paid).not.toContain("csv-order-pending-only");

    const pending = (await agent.get("/api/admin/orders.csv?status=pending").expect(200)).text;
    expect(pending).toContain("csv-order-pending-only");
  });
});
