import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import sharp from "sharp";

/**
 * The design upload, end to end: the crop the browser sends is the crop
 * the print file and the thumbnail are cut with.
 */
let app: Express;

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  app = createApp();
});

/** Left half green, right half blue. */
async function halves(): Promise<Buffer> {
  return sharp({ create: { width: 4000, height: 1000, channels: 3, background: "#00ff00" } })
    .composite([{ input: await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#0000ff" } }).png().toBuffer(), left: 2000, top: 0 }])
    .png()
    .toBuffer();
}

async function edges(bytes: Buffer) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const mid = Math.floor(info.height / 2) * info.width;
  return {
    left: data.subarray(mid * info.channels, (mid + 1) * info.channels),
    right: data.subarray((mid + info.width - 1) * info.channels, (mid + info.width) * info.channels),
  };
}

describe("POST /api/designs", () => {
  it("cuts the print file and the thumbnail with the crop the designer sent", async () => {
    const png = await halves();

    const pinnedLeft = await request(app)
      .post("/api/designs")
      .field("orientation", "landscape")
      .field("crop", JSON.stringify({ x: 0, y: 0.5, zoom: 1 }))
      .attach("file", png, { filename: "a.png", contentType: "image/png" })
      .expect(201);

    const { getDesign } = await import("../db/designs-repository.js");
    const { imageStore } = await import("./image-store.js");
    const design = (await getDesign(pinnedLeft.body.id as string))!;

    const print = await edges(await imageStore.get(design.printPath!));
    expect(print.left[1]).toBeGreaterThan(200);
    expect(print.right[1]).toBeGreaterThan(200);

    const thumb = await edges(await imageStore.get(design.thumbnailPath));
    expect(thumb.left[1]).toBeGreaterThan(200);
    expect(thumb.right[1]).toBeGreaterThan(200);

    // And without a crop, the centre, as it always was: green on the left, blue on the right.
    const centred = await request(app)
      .post("/api/designs")
      .field("orientation", "landscape")
      .attach("file", png, { filename: "a.png", contentType: "image/png" })
      .expect(201);
    const plain = (await getDesign(centred.body.id as string))!;
    const both = await edges(await imageStore.get(plain.printPath!));
    expect(both.left[1]).toBeGreaterThan(200);
    expect(both.right[2]).toBeGreaterThan(200);
  });

  it("refuses a crop it cannot read, and one out of range", async () => {
    const png = await halves();
    await request(app)
      .post("/api/designs")
      .field("orientation", "portrait")
      .field("crop", "{not json")
      .attach("file", png, { filename: "a.png", contentType: "image/png" })
      .expect(400);

    const out = await request(app)
      .post("/api/designs")
      .field("orientation", "portrait")
      .field("crop", JSON.stringify({ x: 2, y: 0.5, zoom: 1 }))
      .attach("file", png, { filename: "a.png", contentType: "image/png" })
      .expect(400);
    expect(out.body.error).toMatch(/crop\.x/);
  });
});

describe("PUT /api/designs/:id", () => {
  async function savedDesign() {
    const response = await request(app)
      .post("/api/designs")
      .field("orientation", "portrait")
      .field("back", JSON.stringify({ text: "Wish you were here" }))
      .attach("file", await halves(), { filename: "a.png", contentType: "image/png" })
      .expect(201);
    return response.body.id as string;
  }

  it("updates the back and returns it, without touching the front", async () => {
    const id = await savedDesign();

    const response = await request(app)
      .put(`/api/designs/${id}`)
      .send({ text: "Miss you lots", valediction: "Love, Rachel", fontName: "Patrick Hand", fontSize: 24, fontColor: "#000000" })
      .expect(200);

    expect(response.body.back.text).toBe("Miss you lots");
    expect(response.body.back.valediction).toBe("Love, Rachel");
    expect(response.body.id).toBe(id);
  });

  it("refuses to change a design that has already been ordered, and leaves it untouched", async () => {
    const id = await savedDesign();
    const { attachDesignsToOrder, getDesign } = await import("../db/designs-repository.js");
    await attachDesignsToOrder([id], "order-for-this-test");

    const response = await request(app).put(`/api/designs/${id}`).send({ text: "Too late" }).expect(409);
    expect(response.body.error).toMatch(/already been ordered/);

    const design = (await getDesign(id))!;
    expect(design.back.text).toBe("Wish you were here");
  });

  it("404s for an id that does not exist", async () => {
    await request(app).put("/api/designs/does-not-exist").send({ text: "hi" }).expect(404);
  });
});
