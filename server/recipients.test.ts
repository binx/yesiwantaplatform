import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Address verification, against a fake Lob.
 *
 * What is asserted is how Lob's answer is read — a different form of the
 * address is offered back in title case, a sub-code collapses to
 * `undeliverable`, an outage is `unknown` — and that the route in front of
 * it is public, CSRF-checked and rate-limited.
 */
let app: Express;
let calls = 0;
let answer: () => Response = () => ok({ deliverability: "deliverable" });

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const SENT = { name: "Grandma", line1: "185 berry street", line2: null, city: "san francisco", state: "CA", postalCode: "94107", country: "US" };
const PASSWORD = "a-sufficiently-long-test-password";

beforeAll(async () => {
  process.env.LOB_API_KEY = "test_abcdef123456";

  vi.stubGlobal("fetch", () => {
    calls += 1;
    return Promise.resolve(answer());
  });

  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");
  const { createCustomer } = await import("./auth.js");

  await runMigrations();
  await seedIfEmpty();
  await createCustomer("verify@example.com", PASSWORD, "Verity");
  app = createApp();
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.LOB_API_KEY;
});

beforeEach(async () => {
  const { resetVerificationCache } = await import("./lob.js");
  resetVerificationCache();
  calls = 0;
});

describe("verifyRecipient", () => {
  it("keeps the buyer's spelling when USPS only changed the case or added ZIP+4", async () => {
    answer = () =>
      ok({
        deliverability: "deliverable",
        primary_line: "185 BERRY ST",
        components: { city: "SAN FRANCISCO", state: "CA", zip_code: "94107", zip_code_plus_4: "1728" },
      });
    const { verifyRecipient } = await import("./lob.js");
    const result = await verifyRecipient({ ...SENT, line1: "185 Berry St", city: "San Francisco" });
    expect(result.deliverability).toBe("deliverable");
    expect(result.changed).toBe(false);
    expect(result.suggested?.line1).toBe("185 Berry St");
  });

  it("offers USPS's form back, in title case, when it differs", async () => {
    answer = () =>
      ok({
        deliverability: "deliverable",
        primary_line: "185 BERRY ST",
        components: { city: "SAN FRANCISCO", state: "CA", zip_code: "94107", zip_code_plus_4: "1728" },
      });
    const { verifyRecipient } = await import("./lob.js");
    const result = await verifyRecipient(SENT);
    expect(result.changed).toBe(true);
    expect(result.suggested).toEqual({ name: "Grandma", line1: "185 Berry St", line2: null, city: "San Francisco", state: "CA", postalCode: "94107-1728", country: "US" });
  });

  it("collapses Lob's sub-codes and keeps directionals upper-case", async () => {
    answer = () => ok({ deliverability: "undeliverable_no_match" });
    const { verifyRecipient } = await import("./lob.js");
    expect(await verifyRecipient(SENT)).toEqual({ deliverability: "undeliverable", suggested: null, changed: false });

    answer = () =>
      ok({
        deliverability: "deliverable_missing_unit",
        primary_line: "12 NE 3RD AVE",
        components: { city: "PORTLAND", state: "OR", zip_code: "97232" },
      });
    const missing = await verifyRecipient({ ...SENT, line1: "12 northeast 3rd avenue", city: "portland", state: "OR", postalCode: "97232", country: "US" });
    expect(missing.deliverability).toBe("deliverable_missing_unit");
    expect(missing.changed).toBe(true);
    expect(missing.suggested?.line1).toBe("12 NE 3rd Ave");
    expect(missing.suggested?.city).toBe("Portland");
  });

  it("answers unknown when Lob is down or refuses the request, never blocking a sale", async () => {
    const { verifyRecipient } = await import("./lob.js");
    answer = () => new Response("bad gateway", { status: 502 });
    expect((await verifyRecipient(SENT)).deliverability).toBe("unknown");
    answer = () => new Response(JSON.stringify({ error: { message: "zip_code is invalid" } }), { status: 422 });
    expect((await verifyRecipient({ ...SENT, postalCode: "94108", country: "US" })).deliverability).toBe("unknown");
    answer = () => {
      throw new TypeError("fetch failed");
    };
    expect((await verifyRecipient({ ...SENT, postalCode: "94109", country: "US" })).deliverability).toBe("unknown");
  });

  it("asks Lob's international endpoint abroad, and offers no corrected form", async () => {
    let url = "";
    vi.stubGlobal("fetch", (input: string | URL | Request) => {
      calls += 1;
      url = input instanceof Request ? input.url : String(input);
      return Promise.resolve(answer());
    });
    answer = () => ok({ deliverability: "deliverable" });
    const { verifyRecipient } = await import("./lob.js");
    const abroad = { name: "Maya", line1: "12 Rue Ste-Catherine", line2: null, city: "Montréal", state: "QC", postalCode: "H2X 1K4", country: "CA" };
    const result = await verifyRecipient(abroad);
    expect(url).toContain("/intl_verifications");
    expect(result).toEqual({ deliverability: "deliverable", suggested: abroad, changed: false });

    answer = () => ok({ deliverability: "undeliverable_unknown_entity" });
    expect((await verifyRecipient({ ...abroad, postalCode: "H0H 0H0" })).deliverability).toBe("undeliverable");
  });

  it("asks Lob once per address", async () => {
    answer = () => ok({ deliverability: "deliverable", primary_line: "185 BERRY ST", components: { city: "SAN FRANCISCO", state: "CA", zip_code: "94107" } });
    const { verifyRecipient } = await import("./lob.js");
    await verifyRecipient(SENT);
    await verifyRecipient({ ...SENT, name: "Someone Else", line1: "185 Berry Street" });
    expect(calls).toBe(1);
  });
});

describe("POST /api/recipients/verify", () => {
  async function anonymous() {
    const agent = request.agent(app);
    const { body } = await agent.get("/api/session").expect(200);
    return { agent, csrf: body.csrfToken as string };
  }

  it("requires a CSRF token, like every other public write", async () => {
    await request(app).post("/api/recipients/verify").send(SENT).expect(403);
  });

  it("refuses an address the schema refuses", async () => {
    const { agent, csrf } = await anonymous();
    const response = await agent.post("/api/recipients/verify").set("x-csrf-token", csrf).send({ ...SENT, postalCode: "9410" }).expect(400);
    expect(response.body.error).toMatch(/postalCode/);
  });

  it("answers with the verification", async () => {
    answer = () => ok({ deliverability: "deliverable", primary_line: "185 BERRY ST", components: { city: "SAN FRANCISCO", state: "CA", zip_code: "94107" } });
    const { agent, csrf } = await anonymous();
    const response = await agent.post("/api/recipients/verify").set("x-csrf-token", csrf).send(SENT).expect(200);
    expect(response.body.deliverability).toBe("deliverable");
    expect(response.body.changed).toBe(true);
    expect(response.body.suggested.line1).toBe("185 Berry St");
  });

  it("records on a saved recipient that Lob called it deliverable", async () => {
    answer = () => ok({ deliverability: "deliverable", primary_line: "185 BERRY STREET", components: { city: "SAN FRANCISCO", state: "CA", zip_code: "94107" } });
    const agent = request.agent(app);
    const bootstrap = await agent.get("/api/session").expect(200);
    const login = await agent
      .post("/api/account/session")
      .set("x-csrf-token", bootstrap.body.csrfToken as string)
      .send({ email: "verify@example.com", password: PASSWORD })
      .expect(200);
    const csrf = login.body.csrfToken as string;

    const created = await agent.post("/api/account/addresses").set("x-csrf-token", csrf).send(SENT).expect(201);
    expect(typeof created.body.verifiedAt).toBe("number");

    answer = () => ok({ deliverability: "undeliverable" });
    const updated = await agent
      .put(`/api/account/addresses/${created.body.id as string}`)
      .set("x-csrf-token", csrf)
      .send({ ...SENT, line1: "1 Nowhere Rd" })
      .expect(200);
    expect(updated.body.verifiedAt).toBeNull();

    const listed = await agent.get("/api/account/addresses").expect(200);
    const addresses = listed.body as { id: string; verifiedAt: number | null }[];
    expect(addresses.find((a) => a.id === created.body.id)?.verifiedAt).toBeNull();
  });

  it("saves the address book's own fields through the account routes", async () => {
    answer = () => ok({ deliverability: "deliverable" });
    const agent = request.agent(app);
    const bootstrap = await agent.get("/api/session").expect(200);
    const login = await agent
      .post("/api/account/session")
      .set("x-csrf-token", bootstrap.body.csrfToken as string)
      .send({ email: "verify@example.com", password: PASSWORD })
      .expect(200);
    const csrf = login.body.csrfToken as string;

    const created = await agent
      .post("/api/account/addresses")
      .set("x-csrf-token", csrf)
      .send({ ...SENT, name: "Maya", label: "Mom", tags: ["Family", "holiday"], birthday: "10-14", notes: "Beach ones." })
      .expect(201);
    expect(created.body).toMatchObject({ label: "Mom", tags: ["family", "holiday"], birthday: "10-14", notes: "Beach ones.", source: "manual" });

    await agent
      .post("/api/account/addresses")
      .set("x-csrf-token", csrf)
      .send({ ...SENT, name: "Nope", birthday: "October 14" })
      .expect(400);
  });

  it("is rate-limited per address, well above what a person needs", async () => {
    answer = () => ok({ deliverability: "deliverable" });
    const { agent, csrf } = await anonymous();
    let limited = 0;
    for (let i = 0; i < 130 && limited === 0; i += 1) {
      const response = await agent.post("/api/recipients/verify").set("x-csrf-token", csrf).send({ ...SENT, postalCode: String(10000 + i) });
      if (response.status === 429) limited = i + 1;
    }
    expect(limited).toBeGreaterThan(0);
    expect(limited).toBeLessThanOrEqual(121);
  });
});
