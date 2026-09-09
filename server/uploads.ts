import { randomUUID } from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { env } from "./env.js";
import { httpError } from "./middleware.js";
import { imageStore, isSafeRelativePath } from "./image-store.js";
import { DERIVATIVE_WIDTHS, derivativePath, derivativeWidthsFor } from "../shared/images.js";

// Where the local driver writes. Re-exported because the static handler in
// server/app.ts and the boot check in server/index.ts read it from here.
export { ASSETS_ROOT } from "./image-store.js";

/**
 * Image uploads.
 *
 * v1 wrote `file.originalname` verbatim into a directory built from an
 * unsanitised route parameter, so a crafted filename escaped the assets tree.
 * It also trusted the browser's Content-Type and required no authentication.
 *
 * Here: the file never touches disk under a client-supplied name, the bytes
 * are decoded by sharp before anything is written (so the magic bytes must
 * really be an image), and the re-encode strips EXIF and any appended payload.
 */

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif"]);

/**
 * The most pixels an upload may decode to: 50 megapixels, roughly 7000×7000.
 *
 * `MAX_UPLOAD_BYTES` bounds the file, not the image — a few kilobytes of PNG
 * can declare 30000×30000 and decode to gigabytes. sharp's own default allows
 * 268 megapixels, and nothing in a catalogue needs more than a fraction of it.
 */
const MAX_INPUT_PIXELS = 50_000_000;
/** Buffer in memory so nothing is persisted before it has been validated. */
export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    // A cheap first pass; sharp does the authoritative check below.
    if (!file.mimetype.startsWith("image/")) {
      cb(httpError(415, "Only image uploads are accepted."));
      return;
    }
    cb(null, true);
  },
}).single("file");

/**
 * Owner directories are named by product or collection id. Ids we generate are
 * UUIDs or short slugs; anything else is refused rather than sanitised, so
 * there is no encoding trick to smuggle a traversal through.
 */
function assertSafeOwnerId(ownerId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(ownerId)) {
    throw httpError(400, "Invalid upload target.");
  }
}

export interface StoredImage {
  /** Path relative to the assets root, as stored in the database. */
  path: string;
  width: number;
  height: number;
  /** Widths of the derivatives written next to `path`, for `srcset`. */
  widths: number[];
}



export async function storeImage(ownerId: string, buffer: Buffer): Promise<StoredImage> {
  assertSafeOwnerId(ownerId);

  let image = sharp(buffer, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS });
  let metadata;

  try {
    metadata = await image.metadata();
  } catch {
    throw httpError(415, "That file is not a readable image.");
  }

  const format = metadata.format ?? "";
  if (!ALLOWED_FORMATS.has(format)) {
    throw httpError(415, `Unsupported image format: ${format || "unknown"}.`);
  }
  if (!metadata.width || !metadata.height) {
    throw httpError(415, "Could not read the image dimensions.");
  }

  // Cap stored dimensions; a 12000px original helps nobody and costs bandwidth.
  const MAX_EDGE = 2400;
  if (metadata.width > MAX_EDGE || metadata.height > MAX_EDGE) {
    image = image.resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true });
  }

  // Re-encode rather than copying bytes: this is what drops EXIF and anything
  // appended after the image data.
  const isAnimated = format === "gif" && (metadata.pages ?? 1) > 1;
  const output = isAnimated
    ? await sharp(buffer, { animated: true, limitInputPixels: MAX_INPUT_PIXELS })
        .gif()
        .toBuffer({ resolveWithObject: true })
    : await image
        .rotate() // honour EXIF orientation before we discard the metadata
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });

  const extension = isAnimated ? "gif" : "webp";
  const relativePath = `${ownerId}/${randomUUID()}.${extension}`;

  // The store — disk or bucket — is what holds the bytes; see server/image-store.ts.
  // Its own traversal check is the second line behind `assertSafeOwnerId`.
  await imageStore.put(relativePath, output.data, isAnimated ? "image/gif" : "image/webp");

  /*
   * Resized copies for `srcset`.
   *
   * Without these the storefront serves one file to everyone, so a phone
   * rendering a card 180px wide still downloads the 2400px original — the
   * largest single waste of bytes on a shop page.
   *
   * Animated GIFs are skipped: resizing them frame by frame is slow and the
   * result is usually worse than leaving the original alone.
   */
  const widths: number[] = [];

  if (!isAnimated) {
    for (const width of derivativeWidthsFor(output.info.width)) {
      const resized = await sharp(output.data)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();

      await imageStore.put(derivativePath(relativePath, width), resized, "image/webp");
      widths.push(width);
    }
  }

  return {
    path: relativePath,
    width: output.info.width,
    height: output.info.height,
    widths,
  };
}

/**
 * Delete a stored image.
 *
 * The stored path is re-validated first, so a tampered database row cannot be
 * used to unlink something outside the assets tree, or to name a bucket key
 * the store never wrote.
 */
export async function deleteImageFile(relativePath: string): Promise<void> {
  if (!isSafeRelativePath(relativePath)) {
    throw httpError(400, "Invalid image path.");
  }

  await imageStore.delete(relativePath);

  // The derivatives are not in the database individually, so they are removed
  // by the same naming rule that created them. Every candidate is derived from
  // the validated full-size path, so none can point outside the tree.
  await Promise.all(
    DERIVATIVE_WIDTHS.map((width) => imageStore.delete(derivativePath(relativePath, width))),
  );
}
