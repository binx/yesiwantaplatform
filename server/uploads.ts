import { randomUUID } from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { env } from "./env.js";
import { httpError, type ApiError } from "./middleware.js";
import { imageStore, isSafeRelativePath } from "./image-store.js";
import { DERIVATIVE_WIDTHS, derivativePath, derivativeWidthsFor } from "../shared/images.js";
import { PRINT_SIZES, defaultCrop, type Crop, type Orientation } from "../shared/postcards.js";
import { cropToCard, finishPrintFile } from "./lob.js";

// Where the local driver writes. Re-exported because the static handler in
// server/app.ts and the boot check in server/index.ts read it from here.
export { ASSETS_ROOT } from "./image-store.js";

/**
 * Image uploads: the store's own imagery (logo, hero) and postcard designs.
 *
 * The file never touches disk under a client-supplied name, the bytes are
 * decoded by sharp before anything is written (so the magic bytes must really
 * be an image), and the re-encode strips EXIF and any appended payload.
 */

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif", "heif", "tiff"]);

/** The most pixels an upload may decode to: 50 megapixels, roughly 7000×7000. */
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

/** Multer's own errors carry a `code` but no `status`; give the size limit a real message. */
export function mapUploadError(error: unknown): ApiError {
  if (!(error instanceof multer.MulterError)) {
    return error instanceof Error ? error : httpError(400, "Upload failed.");
  }

  if (error.code === "LIMIT_FILE_SIZE") {
    const maxMb = Math.round(env.MAX_UPLOAD_BYTES / (1024 * 1024));
    return httpError(413, `That image is larger than ${maxMb} MB. Export it smaller and try again.`);
  }

  return httpError(400, error.message);
}

/** Owner directories are UUIDs or short slugs; anything else is refused rather than sanitised. */
function assertSafeOwnerId(ownerId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(ownerId)) {
    throw httpError(400, "Invalid upload target.");
  }
}

/** Decode and validate, or throw a 415 that says what was wrong. */
async function readImage(buffer: Buffer) {
  const image = sharp(buffer, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS });

  let metadata;
  try {
    metadata = await image.metadata();
  } catch (error) {
    if (error instanceof Error && error.message.includes("exceeds pixel limit")) {
      throw httpError(415, "That image is over 50 megapixels. Resize it to 7000 px or smaller on its longest side.");
    }
    throw httpError(415, "That file is not a readable image.");
  }

  const format = metadata.format ?? "";
  if (!ALLOWED_FORMATS.has(format)) {
    throw httpError(415, `Unsupported image format: ${format || "unknown"}.`);
  }
  if (!metadata.width || !metadata.height) {
    throw httpError(415, "Could not read the image dimensions.");
  }

  return { image, metadata: { ...metadata, width: metadata.width, height: metadata.height, format } };
}

export interface StoredImage {
  /** Path relative to the assets root, as stored in the database. */
  path: string;
  width: number;
  height: number;
  /** Widths of the derivatives written next to `path`, for `srcset`. */
  widths: number[];
}

/** Store's own imagery: re-encoded to WebP, capped at 2400px, with `srcset` derivatives. */
export async function storeImage(ownerId: string, buffer: Buffer): Promise<StoredImage> {
  assertSafeOwnerId(ownerId);

  const { image: decoded, metadata } = await readImage(buffer);
  let image = decoded;

  const MAX_EDGE = 2400;
  if (metadata.width > MAX_EDGE || metadata.height > MAX_EDGE) {
    image = image.resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true });
  }

  const isAnimated = metadata.format === "gif" && (metadata.pages ?? 1) > 1;
  const output = isAnimated
    ? await sharp(buffer, { animated: true, limitInputPixels: MAX_INPUT_PIXELS })
        .gif()
        .toBuffer({ resolveWithObject: true })
    : await image
        .rotate()
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });

  const extension = isAnimated ? "gif" : "webp";
  const relativePath = `${ownerId}/${randomUUID()}.${extension}`;

  await imageStore.put(relativePath, output.data, isAnimated ? "image/gif" : "image/webp");

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

  return { path: relativePath, width: output.info.width, height: output.info.height, widths };
}

/** Delete a stored image and the derivatives written next to it. */
export async function deleteImageFile(relativePath: string): Promise<void> {
  if (!isSafeRelativePath(relativePath)) {
    throw httpError(400, "Invalid image path.");
  }

  await imageStore.delete(relativePath);
  await Promise.all(
    DERIVATIVE_WIDTHS.map((width) => imageStore.delete(derivativePath(relativePath, width))),
  );
}

/* ------------------------------------------------------------------ designs */

export interface StoredDesign {
  printPath: string;
  thumbnailPath: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
}

/**
 * What the site needs to say on the upload control. Below this the print
 * will look soft; the pipeline still accepts the file, because a buyer who
 * only has the one photo of their grandmother would rather have it slightly
 * soft than not at all.
 */
export const RECOMMENDED_MIN = PRINT_SIZES.portrait;

/** The thumbnail's longest edge. Enough for the cart and the order page. */
const THUMBNAIL_EDGE = 600;

/**
 * Store a postcard design: the print-ready front and a thumbnail of it.
 *
 * Two files, both derived once here so nothing is rendered again at send
 * time. The print file is what v1 built on a browser canvas and posted as a
 * 50 MB JSON string; it is made server-side now, from the original, with the
 * density Lob expects — see `printFile` in server/lob.ts for why that matters.
 */
export async function storePostcardDesign(
  designId: string,
  buffer: Buffer,
  orientation: Orientation,
  crop: Crop = defaultCrop,
): Promise<StoredDesign> {
  assertSafeOwnerId(designId);
  await readImage(buffer);

  // The card face, cropped once. The print file and the thumbnail are both
  // cut from it, so there is one crop and not two that can drift apart.
  const card = await cropToCard(buffer, orientation, crop);

  const print = await finishPrintFile(card, orientation);
  const printPath = `designs/${designId}/print.png`;
  await imageStore.put(printPath, print.bytes, "image/png");

  // The thumbnail shows the design the way the buyer holds it — portrait
  // stays portrait — so it is cut from the face, not the rotated print.
  const thumb = await sharp(card)
    .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: "inside" })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });

  const thumbnailPath = `designs/${designId}/thumb.webp`;
  await imageStore.put(thumbnailPath, thumb.data, "image/webp");

  return {
    printPath,
    thumbnailPath,
    thumbnailWidth: thumb.info.width,
    thumbnailHeight: thumb.info.height,
  };
}

/** Remove one of a design's files, tolerating a path that is already gone. */
export async function deleteDesignFile(relativePath: string): Promise<void> {
  if (!isSafeRelativePath(relativePath)) throw httpError(400, "Invalid image path.");
  await imageStore.delete(relativePath);
}

/**
 * Copy a design's files under a new id, for "send again". Both files, both
 * drivers; the caller writes the row and removes the copies if that fails.
 */
export async function copyDesignFiles(design: { printPath: string; thumbnailPath: string }, newId: string): Promise<{ printPath: string; thumbnailPath: string }> {
  assertSafeOwnerId(newId);
  const printPath = `designs/${newId}/print.png`;
  const thumbnailPath = `designs/${newId}/thumb.webp`;
  await imageStore.put(printPath, await imageStore.get(design.printPath), "image/png");
  await imageStore.put(thumbnailPath, await imageStore.get(design.thumbnailPath), "image/webp");
  return { printPath, thumbnailPath };
}
