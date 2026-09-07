import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Shipping over the wire.
 *
 * The property worth pinning is that the cart page and the checkout route
 * agree: both resolve rates through `quoteShipping`, from identifiers and the
 * catalogue, never from a price the client sent. v1 let the browser pick the
 * shipping SKU outright.
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
  await createAdmin("shipping@example.com", PASSWORD);

  app = createApp();
});

interface Zone {
  id: string;
  name: string;
  countryCodes: string[];
}
interface Rate {
  id: string;
  name: string;
  priceCents: number;
  zoneId: string | null;
}
interface Table {
  zones: Zone[];
  rates: Rate[];
}
interface Quote {
  rates: { id: string; name: string; priceCents: number }[];
  subtotalCents: number;
  weightGrams: number;
  gap: boolean;
}

async function signIn() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);

  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email: "shipping@example.com", password: PASSWORD })
    .expect(200);

  return { agent, csrf: login.body.csrfToken as string };
}

const TABLE = {
  zones: [
    { id: "z-dom", name: "Domestic", countryCodes: ["US"] },
    { id: "z-eu", name: "Europe", countryCodes: ["GB", "DE"] },
  ],
  rates: [
    {
      name: "US standard",
      priceCents: 500,
      zoneId: "z-dom",
      minWeightGrams: null,
      maxWeightGrams: null,
      minSubtotalCents: null,
      maxSubtotalCents: 4999,
      isActive: true,
    },
    {
      name: "US free over 50",
      priceCents: 0,
      zoneId: "z-dom",
      minWeightGrams: null,
      maxWeightGrams: null,
      minSubtotalCents: 5000,
      maxSubtotalCents: null,
      isActive: true,
    },
    {
      name: "Europe",
      priceCents: 1500,
      zoneId: "z-eu",
      minWeightGrams: null,
      maxWeightGrams: null,
      minSubtotalCents: null,
      maxSubtotalCents: null,
      isActive: true,
    },
  ],
};

describe("authorization", () => {
  it("refuses to read the shipping table anonymously", async () => {
    await request(app).get("/api/admin/shipping").expect(401);
  });

  it("refuses to write the shipping table anonymously", async () => {
    await request(app).put("/api/admin/shipping").send(TABLE).expect(401);
  });

  it("refuses an authenticated write with no CSRF token", async () => {
    const { agent } = await signIn();
    await agent.put("/api/admin/shipping").send(TABLE).expect(403);
  });
});

describe("saving the table", () => {
  it("round-trips zones and rates", async () => {
    const { agent, csrf } = await signIn();

    await agent.put("/api/admin/shipping").set("x-csrf-token", csrf).send(TABLE).expect(204);

    const body = (await agent.get("/api/admin/shipping").expect(200)).body as Table;

    expect(body.zones.map((z) => z.name)).toEqual(["Domestic", "Europe"]);
    expect(body.rates).toHaveLength(3);
  });

  it("reissues zone ids rather than trusting the client's", async () => {
    const { agent } = await signIn();
    const body = (await agent.get("/api/admin/shipping").expect(200)).body as Table;

    // Nothing a browser sent becomes a primary key.
    expect(body.zones.map((z) => z.id)).not.toContain("z-dom");
  });

  it("repoints rates at the zones written in the same save", async () => {
    const { agent } = await signIn();
    const body = (await agent.get("/api/admin/shipping").expect(200)).body as Table;

    const domestic = body.zones.find((z) => z.name === "Domestic");
    const usRates = body.rates.filter((r) => r.zoneId === domestic?.id);

    expect(usRates.map((r) => r.name).sort()).toEqual([
      "US free over 50",
      "US standard",
    ]);
  });

  it("rejects a rate pointing at a zone that is not in the payload", async () => {
    const { agent, csrf } = await signIn();

    const response = await agent
      .put("/api/admin/shipping")
      .set("x-csrf-token", csrf)
      .send({
        zones: [],
        rates: [{ ...TABLE.rates[0], zoneId: "nonexistent" }],
      })
      .expect(400);

    expect(response.body.error).toMatch(/zone that is not in this save/i);
  });

  it("did not apply the rejected save", async () => {
    const { agent } = await signIn();
    const body = (await agent.get("/api/admin/shipping").expect(200)).body as Table;

    // The validation runs before the delete, so the table is untouched.
    expect(body.zones).toHaveLength(2);
  });
});

describe("quoting", () => {
  /** A real cart line from the seeded catalogue. */
  async function line(quantity: number) {
    const body = (await request(app).get("/api/products/canvas-tote").expect(200)).body as {
      id: string;
      variants: { id: string; priceCents: number }[];
    };
    const variant = body.variants[0];
    if (!variant) throw new Error("The seeded catalogue has no variants.");

    return {
      productId: body.id,
      variantId: variant.id,
      quantity,
      unitPriceCents: variant.priceCents,
    };
  }

  it("offers the destination's rates and nothing else", async () => {
    const item = await line(1);

    const body = (
      await request(app)
        .post("/api/shipping/quote")
        .send({ lines: [item], countryCode: "GB" })
        .expect(200)
    ).body as Quote;

    expect(body.rates.map((r) => r.name)).toEqual(["Europe"]);
  });

  it("prices from the catalogue, not from anything the client sends", async () => {
    const item = await line(1);

    const body = (
      await request(app)
        .post("/api/shipping/quote")
        // A tampered subtotal must not buy free shipping.
        .send({ lines: [{ ...item, unitPriceCents: 999_999 }], countryCode: "US" })
        .expect(200)
    ).body as Quote;

    expect(body.subtotalCents).toBe(item.unitPriceCents);
  });

  it("crosses the free-shipping threshold on real quantities", async () => {
    const item = await line(1);
    const enough = Math.ceil(5000 / item.unitPriceCents);

    const cheap = (
      await request(app)
        .post("/api/shipping/quote")
        .send({ lines: [{ ...item, quantity: 1 }], countryCode: "US" })
        .expect(200)
    ).body as Quote;

    const dear = (
      await request(app)
        .post("/api/shipping/quote")
        .send({ lines: [{ ...item, quantity: enough }], countryCode: "US" })
        .expect(200)
    ).body as Quote;

    expect(cheap.rates.map((r) => r.name)).toEqual(["US standard"]);
    expect(dear.rates.map((r) => r.name)).toEqual(["US free over 50"]);
  });

  it("reports a gap rather than inventing a rate", async () => {
    const item = await line(1);

    const body = (
      await request(app)
        .post("/api/shipping/quote")
        // No zone covers Japan and there is no catch-all.
        .send({ lines: [item], countryCode: "JP" })
        .expect(200)
    ).body as Quote;

    expect(body.rates).toEqual([]);
    expect(body.gap).toBe(true);
  });

  it("rejects a malformed country code", async () => {
    await request(app)
      .post("/api/shipping/quote")
      .send({ lines: [], countryCode: "United States" })
      .expect(400);
  });
});

describe("the storefront payload", () => {
  it("advertises the countries the store can price", async () => {
    const body = (await request(app).get("/api/store").expect(200)).body as {
      shipping: { countries: string[]; worldwide: boolean };
    };

    expect(body.shipping.countries.sort()).toEqual(["DE", "GB", "US"]);
    // No catch-all zone was configured, so unlisted countries are not priced.
    expect(body.shipping.worldwide).toBe(false);
  });
});
