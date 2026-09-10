import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import sharp from "sharp";

/**
 * The gallery routes: a customer sees only their own designs, "send again"
 * copies the files under a new id, and only drafts can be deleted.
 */
let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");
  const { createCustomer } = await import("./auth.js");

  await runMigrations();
  await seedIfEmpty();
  await createCustomer("gallery-a@example.com", PASSWORD, "Ada");
  await createCustomer("gallery-b@example.com", PASSWORD, "Bea");
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

/** A design saved while signed in, so it is the customer's. */
async function saveDesign(agent: request.Agent, colour: string): Promise<string> {
  const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: colour } }).png().toBuffer();
  const response = await agent
    .post("/api/designs")
    .field("orientation", "landscape")
    .field("back", JSON.stringify({ text: "Hello from the gallery test" }))
    .attach("file", png, { filename: "a.png", contentType: "image/png" })
    .expect(201);
  return response.body.id as string;
}

describe("the gallery", () => {
  it("lists only the signed-in customer's designs, and 404s another customer's", async () => {
    const ada = await signIn("gallery-a@example.com");
    const bea = await signIn("gallery-b@example.com");
    const adasDesign = await saveDesign(ada.agent, "#ff0000");
    await saveDesign(bea.agent, "#00ff00");

    const adasList = await ada.agent.get("/api/account/designs").expect(200);
    const designs = adasList.body.designs as { id: string; ordered: boolean }[];
    expect(designs.map((d) => d.id)).toContain(adasDesign);
    expect(designs.find((d) => d.id === adasDesign)?.ordered).toBe(false);

    await bea.agent.get(`/api/account/designs/${adasDesign}`).expect(404);
    await bea.agent.post(`/api/account/designs/${adasDesign}/duplicate`).set("x-csrf-token", bea.csrf).expect(404);
    await bea.agent.delete(`/api/account/designs/${adasDesign}`).set("x-csrf-token", bea.csrf).expect(404);

    const detail = await ada.agent.get(`/api/account/designs/${adasDesign}`).expect(200);
    expect(detail.body).toMatchObject({ id: adasDesign, ordered: false, canSendAgain: true, cards: [], copies: [] });
  });

  it("copies a design's files under a new id for 'send again', and remembers the origin", async () => {
    const ada = await signIn("gallery-a@example.com");
    const original = await saveDesign(ada.agent, "#0000ff");

    const copied = await ada.agent.post(`/api/account/designs/${original}/duplicate`).set("x-csrf-token", ada.csrf).expect(201);
    const copyId = copied.body.id as string;
    expect(copyId).not.toBe(original);
    expect(copied.body.back.text).toBe("Hello from the gallery test");

    const { getDesign } = await import("../db/designs-repository.js");
    const { imageStore } = await import("./image-store.js");
    const copy = (await getDesign(copyId))!;
    expect(copy.originId).toBe(original);
    expect(copy.printPath).toBe(`designs/${copyId}/print.png`);
    const originalBytes = await imageStore.get((await getDesign(original))!.printPath!);
    expect(Buffer.compare(await imageStore.get(copy.printPath!), originalBytes)).toBe(0);

    // The public designs route — what the designer reads `?designs=` through — knows the copy.
    const pub = await request(app).get(`/api/designs?ids=${copyId}`).expect(200);
    expect(pub.body[0].id).toBe(copyId);

    const detail = await ada.agent.get(`/api/account/designs/${original}`).expect(200);
    expect((detail.body.copies as { id: string }[]).map((d) => d.id)).toEqual([copyId]);
  });

  it("deletes a draft with its files, and refuses to delete an ordered design", async () => {
    const ada = await signIn("gallery-a@example.com");
    const draft = await saveDesign(ada.agent, "#ffff00");
    const { getDesign, attachDesignsToOrder } = await import("../db/designs-repository.js");
    const { imageStore } = await import("./image-store.js");
    const path = (await getDesign(draft))!.thumbnailPath;

    await ada.agent.delete(`/api/account/designs/${draft}`).set("x-csrf-token", ada.csrf).expect(204);
    expect(await getDesign(draft)).toBeNull();
    await expect(imageStore.get(path)).rejects.toThrow();

    const ordered = await saveDesign(ada.agent, "#ff00ff");
    await attachDesignsToOrder([ordered], "some-order");
    const refused = await ada.agent.delete(`/api/account/designs/${ordered}`).set("x-csrf-token", ada.csrf).expect(409);
    expect(refused.body.error).toMatch(/stay in your gallery/);
  });
});
