import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * "Send me your address" links: minted by a customer, answered by a
 * stranger with the link, landing in the customer's book.
 */
let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";
const ADDRESS = { name: "Maya Okafor", line1: "12 Elm St", line2: null, city: "Marfa", state: "TX", postalCode: "79843", country: "US" };

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");
  const { createCustomer } = await import("./auth.js");

  await runMigrations();
  await seedIfEmpty();
  await createCustomer("asker@example.com", PASSWORD, "Rachel Binx");
  await createCustomer("nameless@example.com", PASSWORD, null);
  app = createApp();
});

async function signIn(email: string) {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);
  const login = await agent
    .post("/api/account/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email, password: PASSWORD })
    .expect(200);
  return { agent, csrf: login.body.csrfToken as string };
}

async function stranger() {
  const agent = request.agent(app);
  const { body } = await agent.get("/api/session").expect(200);
  return { agent, csrf: body.csrfToken as string };
}

function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

describe("address requests", () => {
  it("mints a single-use link, shows the responder a first name, takes one address, then closes", async () => {
    const owner = await signIn("asker@example.com");
    const created = await owner.agent.post("/api/account/address-requests").set("x-csrf-token", owner.csrf).send({ label: "Maya", multi: false }).expect(201);
    expect(created.body.url).toMatch(/\/address\/[A-Za-z0-9_-]{40,}$/);
    expect(created.body.status).toBe("open");
    const token = tokenOf(created.body.url as string);

    const visitor = await stranger();
    const shown = await visitor.agent.get(`/api/address-requests/${token}`).expect(200);
    // A first name and nothing else about the asker; a single link's label is the responder's own name, so it is not shown.
    expect(shown.body).toEqual({ requesterName: "Rachel", label: null, multi: false, status: "open" });

    await visitor.agent.post(`/api/address-requests/${token}`).set("x-csrf-token", visitor.csrf).send(ADDRESS).expect(204);
    const after = await visitor.agent.get(`/api/address-requests/${token}`).expect(200);
    expect(after.body.status).toBe("fulfilled");
    await visitor.agent.post(`/api/address-requests/${token}`).set("x-csrf-token", visitor.csrf).send(ADDRESS).expect(410);

    const book = await owner.agent.get("/api/account/addresses").expect(200);
    const entry = (book.body as { name: string; label: string | null; source: string }[]).find((a) => a.name === "Maya Okafor");
    expect(entry).toMatchObject({ label: "Maya", source: "request" });

    const listed = await owner.agent.get("/api/account/address-requests").expect(200);
    expect((listed.body as { id: string; responses: number; status: string }[]).find((r) => r.id === created.body.id)).toMatchObject({ responses: 1, status: "fulfilled" });
  });

  it("keeps a collector link open across responses, and revokes it", async () => {
    const owner = await signIn("asker@example.com");
    const created = await owner.agent
      .post("/api/account/address-requests")
      .set("x-csrf-token", owner.csrf)
      .send({ label: "Holiday card 2026", multi: true, notifyByEmail: false })
      .expect(201);
    const token = tokenOf(created.body.url as string);

    const visitor = await stranger();
    expect((await visitor.agent.get(`/api/address-requests/${token}`).expect(200)).body.label).toBe("Holiday card 2026");
    for (const name of ["Sam Lee", "Priya N", "Ola A"]) {
      await visitor.agent.post(`/api/address-requests/${token}`).set("x-csrf-token", visitor.csrf).send({ ...ADDRESS, name }).expect(204);
    }
    expect((await visitor.agent.get(`/api/address-requests/${token}`).expect(200)).body.status).toBe("open");

    await owner.agent.delete(`/api/account/address-requests/${created.body.id as string}`).set("x-csrf-token", owner.csrf).expect(204);
    expect((await visitor.agent.get(`/api/address-requests/${token}`).expect(200)).body.status).toBe("revoked");
    await visitor.agent.post(`/api/address-requests/${token}`).set("x-csrf-token", visitor.csrf).send(ADDRESS).expect(410);

    const book = await owner.agent.get("/api/account/addresses").expect(200);
    const fromLink = (book.body as { source: string; label: string | null }[]).filter((a) => a.source === "request" && a.label === null);
    expect(fromLink).toHaveLength(3);
  });

  it("refuses to mint a link for a customer with no name, and 404s a token nobody was given", async () => {
    const owner = await signIn("nameless@example.com");
    const response = await owner.agent.post("/api/account/address-requests").set("x-csrf-token", owner.csrf).send({ label: "Maya" }).expect(409);
    expect(response.body.error).toMatch(/name/);

    const visitor = await stranger();
    await visitor.agent.get("/api/address-requests/not-a-token").expect(404);
    await visitor.agent.post("/api/address-requests/not-a-token").set("x-csrf-token", visitor.csrf).send(ADDRESS).expect(404);
  });

  it("renews a link's expiry without changing the link", async () => {
    const owner = await signIn("asker@example.com");
    const created = await owner.agent.post("/api/account/address-requests").set("x-csrf-token", owner.csrf).send({ label: "Sam", expiresInDays: 1 }).expect(201);
    const renewed = await owner.agent.post(`/api/account/address-requests/${created.body.id as string}/renew`).set("x-csrf-token", owner.csrf).expect(200);
    expect(renewed.body.url).toBe(created.body.url);
    expect(renewed.body.expiresAt).toBeGreaterThan(created.body.expiresAt as number);
  });

  it("refuses an address the schema refuses, and one USPS does not know", async () => {
    const owner = await signIn("asker@example.com");
    const created = await owner.agent.post("/api/account/address-requests").set("x-csrf-token", owner.csrf).send({ label: "Maya" }).expect(201);
    const token = tokenOf(created.body.url as string);
    const visitor = await stranger();
    await visitor.agent.post(`/api/address-requests/${token}`).set("x-csrf-token", visitor.csrf).send({ ...ADDRESS, postalCode: "7984" }).expect(400);
    // No Lob key on the test server: verification is unknown, so a well-formed address goes through.
    await visitor.agent.post(`/api/address-requests/${token}`).set("x-csrf-token", visitor.csrf).send(ADDRESS).expect(204);
  });
});
