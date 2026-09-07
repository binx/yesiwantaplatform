import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import sharp from "sharp";
import { env } from "./env.js";
import { httpError } from "./middleware.js";

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

export const ASSETS_ROOT = path.resolve("public/assets");

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif"]);
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
}

export async function storeImage(ownerId: string, buffer: Buffer): Promise<StoredImage> {
  assertSafeOwnerId(ownerId);

  let image = sharp(buffer, { failOn: "error" });
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
    ? await sharp(buffer, { animated: true }).gif().toBuffer({ resolveWithObject: true })
    : await image
        .rotate() // honour EXIF orientation before we discard the metadata
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });

  const extension = isAnimated ? "gif" : "webp";
  const filename = `${randomUUID()}.${extension}`;
  const directory = path.join(ASSETS_ROOT, ownerId);

  // Belt and braces: confirm the resolved path is still inside the tree.
  const destination = path.join(directory, filename);
  if (!destination.startsWith(ASSETS_ROOT + path.sep)) {
    throw httpError(400, "Invalid upload target.");
  }

  await mkdir(directory, { recursive: true });
  await writeFile(destination, output.data);

  return {
    path: `${ownerId}/${filename}`,
    width: output.info.width,
    height: output.info.height,
  };
}

/**
 * Delete a stored image.
 *
 * The stored path is re-validated the same way, so a tampered database row
 * cannot be used to unlink something outside the assets tree.
 */
export async function deleteImageFile(relativePath: string): Promise<void> {
  const resolved = path.resolve(ASSETS_ROOT, relativePath);

  if (!resolved.startsWith(ASSETS_ROOT + path.sep)) {
    throw httpError(400, "Invalid image path.");
  }

  await unlink(resolved).catch((error: NodeJS.ErrnoException) => {
    // Already gone is a success for our purposes.
    if (error.code !== "ENOENT") throw error;
  });
}
