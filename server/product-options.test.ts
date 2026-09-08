import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Multi-axis variants, exercised through the admin API rather than the
 * repository directly — the checks this covers (a well-formed combination per
 * variant, no two variants sharing one) live in the route, not the schema, so
 * they only mean something asserted at that boundary. See docs/tasks/10-multi-axis-variants.md.
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("admin@example.com", PASSWORD);

  app = createApp();
});

async function signIn() {
  const agent = request.agent(app);

  const bootstrap = await agent.get("/api/session").expect(200);
  const initialToken = bootstrap.body.csrfToken as string;

  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", initialToken)
    .send({ email: "admin@example.com", password: PASSWORD })
    .expect(200);

  return { agent, csrf: login.body.csrfToken as string };
}

function twoAxisPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    slug: "striped-tee",
    name: "Striped Tee",
    description: "",
    bulletPoints: [],
    seoTitle: null,
    seoDescription: null,
    taxCode: null,
    isLive: false,
    optionGroups: [],
    options: [
      { name: "Size", values: ["Small", "Large"] },
      { name: "Colour", values: ["Red", "Blue"] },
    ],
    variants: [
      { label: "whatever", priceCents: 2000, inventory: { type: "infinite" }, optionValues: ["Small", "Red"] },
      { label: "whatever", priceCents: 2000, inventory: { type: "infinite" }, optionValues: ["Small", "Blue"] },
      { label: "whatever", priceCents: 2200, inventory: { type: "infinite" }, optionValues: ["Large", "Red"] },
      { label: "whatever", priceCents: 2200, inventory: { type: "infinite" }, optionValues: ["Large", "Blue"] },
    ],
    ...overrides,
  };
}

describe("multi-axis product validation", () => {
  it("rejects two variants naming the same combination", async () => {
    const { agent, csrf } = await signIn();

    const payload = twoAxisPayload({
      variants: [
        { label: "a", priceCents: 2000, inventory: { type: "infinite" }, optionValues: ["Small", "Red"] },
        { label: "b", priceCents: 2100, inventory: { type: "infinite" }, optionValues: ["Small", "Red"] },
      ],
    });

    const response = await agent
      .post("/api/admin/products")
      .set("x-csrf-token", csrf)
      .send(payload)
      .expect(409);

    expect(response.body.error).toMatch(/Small \/ Red/);
  });

  it("rejects a variant that names a value from no such option", async () => {
    const { agent, csrf } = await signIn();

    const payload = twoAxisPayload({
      variants: [
        { label: "a", priceCents: 2000, inventory: { type: "infinite" }, optionValues: ["Small", "Green"] },
      ],
    });

    await agent.post("/api/admin/products").set("x-csrf-token", csrf).send(payload).expect(400);
  });

  it("regenerates each variant's label from its selected values, in axis order", async () => {
    const { agent, csrf } = await signIn();

    const created = await agent
      .post("/api/admin/products")
      .set("x-csrf-token", csrf)
      .send(twoAxisPayload())
      .expect(201);

    const product = await agent
      .get(`/api/admin/products/striped-tee`)
      .expect(200);

    expect(product.body.id).toBe(created.body.id);

    const labels = (product.body.variants as { label: string; priceCents: number }[])
      .map((v) => v.label)
      .sort();

    // Sent as "whatever" — regenerated from the axis values instead.
    expect(labels).toEqual(["Large / Blue", "Large / Red", "Small / Blue", "Small / Red"]);
  });
});
