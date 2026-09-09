import { access } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import multer from "multer";
import { derivativePath } from "../shared/images.js";

/**
 * Responsive derivatives.
 *
 * The point of these files is bytes: without them a phone rendering a card
 * 180px wide downloads the 2400px original. The tests that matter are that the
 * files named in `widths` are really on disk — the storefront trusts that list
 * — and that deleting an image takes them with it.
 */

const OWNER = "test-derivatives";

// `deleteImageFile` removes files, not directories — other images share the
// owner's folder — so the test tidies its own away.
afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  const { ASSETS_ROOT } = await import("./uploads.js");
  await rm(path.join(ASSETS_ROOT, OWNER), { recursive: true, force: true });
});

async function exists(relativePath: string): Promise<boolean> {
  const { ASSETS_ROOT } = await import("./uploads.js");
  return access(path.join(ASSETS_ROOT, relativePath)).then(
    () => true,
    () => false,
  );
}

/** A solid-colour PNG of a given size; sharp re-encodes it on the way in. */
function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#4477aa" } })
    .png()
    .toBuffer();
}

describe("storeImage", () => {
  it("writes a derivative for every width it reports, and no others", async () => {
    const { storeImage, deleteImageFile } = await import("./uploads.js");

    const stored = await storeImage(OWNER, await png(2000, 1500));

    // 1600 is the largest step below 2000; 2400 would be an upscale.
    expect(stored.widths).toEqual([400, 800, 1200, 1600]);

    for (const width of stored.widths) {
      expect(await exists(derivativePath(stored.path, width))).toBe(true);
    }
    expect(await exists(stored.path)).toBe(true);
    // Nothing wider than the source.
    expect(await exists(derivativePath(stored.path, 2400))).toBe(false);

    await deleteImageFile(stored.path);
  });

  it("does not upscale a small image", async () => {
    const { storeImage, deleteImageFile } = await import("./uploads.js");

    const stored = await storeImage(OWNER, await png(500, 400));

    expect(stored.widths).toEqual([400]);
    expect(await exists(derivativePath(stored.path, 800))).toBe(false);

    await deleteImageFile(stored.path);
  });

  it("reports no derivatives for an image below the smallest step", async () => {
    const { storeImage, deleteImageFile } = await import("./uploads.js");

    const stored = await storeImage(OWNER, await png(300, 200));

    // The storefront falls back to the single full-size file.
    expect(stored.widths).toEqual([]);
    expect(await exists(stored.path)).toBe(true);

    await deleteImageFile(stored.path);
  });

  it("actually resizes, rather than copying the original bytes", async () => {
    const { storeImage, deleteImageFile, ASSETS_ROOT } = await import("./uploads.js");

    const stored = await storeImage(OWNER, await png(2000, 1500));
    const small = path.join(ASSETS_ROOT, derivativePath(stored.path, 400));

    const metadata = await sharp(small).metadata();
    expect(metadata.width).toBe(400);
    // Aspect ratio preserved: 2000×1500 is 4:3, so 400 wide is 300 tall.
    expect(metadata.height).toBe(300);

    await deleteImageFile(stored.path);
  });
});

describe("mapUploadError", () => {
  it("turns multer's size limit into a 413 naming the actual cap", async () => {
    const { mapUploadError } = await import("./uploads.js");
    const { env } = await import("./env.js");

    const mapped = mapUploadError(new multer.MulterError("LIMIT_FILE_SIZE"));

    expect(mapped.status).toBe(413);
    const maxMb = Math.round(env.MAX_UPLOAD_BYTES / (1024 * 1024));
    expect(mapped.message).toContain(`${maxMb} MB`);
  });

  it("gives every other multer error a real status instead of a 500", async () => {
    const { mapUploadError } = await import("./uploads.js");

    const mapped = mapUploadError(new multer.MulterError("LIMIT_UNEXPECTED_FILE"));

    expect(mapped.status).toBe(400);
  });

  it("passes through an error that is not from multer unchanged", async () => {
    const { mapUploadError } = await import("./uploads.js");
    const { httpError } = await import("./middleware.js");

    const original = httpError(415, "Only image uploads are accepted.");
    expect(mapUploadError(original)).toBe(original);
  });
});

describe("storeImage, the pixel cap", () => {
  it("says the image is too large, not that it is unreadable", async () => {
    const { storeImage } = await import("./uploads.js");

    // 7100 × 7100 = 50,410,000 pixels, just past the 50-megapixel limit —
    // large enough to trip `limitInputPixels`, not so large the test is slow.
    const oversized = await sharp({
      create: { width: 7100, height: 7100, channels: 3, background: "#4477aa" },
    })
      .png()
      .toBuffer();

    await expect(storeImage(OWNER, oversized)).rejects.toThrow(/50 megapixels/i);
  }, 20_000);
});

describe("deleteImageFile", () => {
  it("removes the derivatives along with the original", async () => {
    const { storeImage, deleteImageFile } = await import("./uploads.js");

    const stored = await storeImage(OWNER, await png(2000, 1500));
    expect(await exists(derivativePath(stored.path, 800))).toBe(true);

    await deleteImageFile(stored.path);

    // Orphaned derivatives would accumulate silently and never be referenced.
    expect(await exists(stored.path)).toBe(false);
    for (const width of stored.widths) {
      expect(await exists(derivativePath(stored.path, width))).toBe(false);
    }
  });

  it("still refuses a path outside the assets tree", async () => {
    const { deleteImageFile } = await import("./uploads.js");

    await expect(deleteImageFile("../../../etc/passwd")).rejects.toThrow(/invalid image path/i);
  });
});
