import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RequestHandler } from "express";
import { AwsClient } from "aws4fetch";
import { env, isProduction, objectStorage } from "./env.js";

/**
 * Where uploaded imagery lives.
 *
 * Two drivers behind one interface. `local` writes under ASSETS_DIR and is
 * the default; `s3` writes to any S3-compatible bucket — AWS, DigitalOcean
 * Spaces, Cloudflare R2, Backblaze, MinIO — which is what lets Beluga run on
 * a platform with no persistent disk, and lets a Postgres deployment run two
 * instances with no shared volume (docs/site-plan.md §7.3).
 *
 * The database holds the same relative path under both, `demo/tote-front.svg`,
 * and the storefront asks for it at the same URL, `/assets/<path>`. Under the
 * bucket driver that request is answered with a redirect (`redirectToImageStore`
 * below, mounted in server/app.ts) rather than by teaching every URL builder a
 * second base. Switching drivers is therefore configuration, not a data
 * migration — and `publicUrl` is the one place the difference shows.
 *
 * The signing library is aws4fetch rather than the AWS SDK: the driver needs
 * PUT and DELETE, and the SDK's client alone is a larger install than the
 * rest of this server's dependencies put together, paid by every deployment
 * including the ones that keep images on disk.
 */

export interface ImageStore {
  readonly driver: "local" | "s3";
  put(relativePath: string, bytes: Buffer, contentType: string): Promise<void>;
  /** The bytes back — the fulfilment sweep sends the print file to Lob from here. */
  get(relativePath: string): Promise<Buffer>;
  delete(relativePath: string): Promise<void>;
  /** Where a browser fetches the file: relative under `local`, absolute under `s3`. */
  publicUrl(relativePath: string): string;
  /** One operator-facing line for the boot log, next to "listening on". */
  describe(): string;
}

/**
 * Absolute, always: every traversal guard is a prefix check against this
 * value, and `path.resolve` is what turns a relative ASSETS_DIR into something
 * a prefix check means anything against. The filesystem root is refused
 * outright — `${root}${sep}` would be `//`, no resolved path starts with that,
 * and every upload would fail with a message about traversal that is not the
 * real problem.
 */
export const ASSETS_ROOT = path.resolve(env.ASSETS_DIR);

if (ASSETS_ROOT === path.parse(ASSETS_ROOT).root) {
  throw new Error(`ASSETS_DIR must be a directory, not the filesystem root (${ASSETS_ROOT}).`);
}

/**
 * A path the database may hold: `owner/file.webp`, slash-separated, with no
 * empty, dot or dot-dot segment and nothing absolute. Both drivers refuse
 * anything else — a bucket key of `../x` is still a key nobody should be able
 * to choose — and the local driver's prefix check is the second line.
 */
export function isSafeRelativePath(relativePath: string): boolean {
  if (relativePath === "" || relativePath.includes("\\") || relativePath.includes("\0")) return false;

  return relativePath
    .split("/")
    .every((segment) => segment !== "" && !segment.startsWith("."));
}

function createLocalStore(root: string): ImageStore {
  const resolve = (relativePath: string): string => {
    const resolved = path.resolve(root, relativePath);

    if (!isSafeRelativePath(relativePath) || !resolved.startsWith(root + path.sep)) {
      throw new Error(`Refusing a path outside the assets tree: ${relativePath}`);
    }

    return resolved;
  };

  return {
    driver: "local",

    async put(relativePath, bytes) {
      const target = resolve(relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    },

    get(relativePath) {
      return readFile(resolve(relativePath));
    },

    async delete(relativePath) {
      await unlink(resolve(relativePath)).catch((error: NodeJS.ErrnoException) => {
        // Already gone is a success for our purposes.
        if (error.code !== "ENOENT") throw error;
      });
    },

    publicUrl: (relativePath) => `/assets/${relativePath}`,

    describe: () => `Images: on disk at ${root} (ASSETS_DIR)`,
  };
}

export interface S3StoreOptions {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style base for a non-AWS provider, e.g. https://nyc3.digitaloceanspaces.com. */
  endpoint?: string | undefined;
  /** What browsers fetch from: the bucket's public address, or a CDN in front of it. */
  publicUrl: string;
  /** Sent as `x-amz-acl` on every object, for providers that want one per object. */
  acl?: string | undefined;
  /** Injected by tests; the global otherwise. */
  fetch?: (request: Request) => Promise<Response>;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export function createS3Store(options: S3StoreOptions): ImageStore {
  const { bucket, region, endpoint, acl } = options;
  const client = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region,
    service: "s3",
  });
  // Resolved per call rather than captured, so a test's stub of the global is seen.
  const send = options.fetch ?? ((request: Request) => fetch(request));

  // Path-style against a custom endpoint, which every S3-compatible provider
  // accepts; virtual-hosted against AWS itself, which is what AWS documents.
  const objectBase = endpoint
    ? `${trimSlash(endpoint)}/${bucket}`
    : `https://${bucket}.s3.${region}.amazonaws.com`;
  const publicBase = trimSlash(options.publicUrl);

  const key = (relativePath: string): string => {
    if (!isSafeRelativePath(relativePath)) {
      throw new Error(`Refusing a bucket key outside the assets tree: ${relativePath}`);
    }
    return relativePath.split("/").map(encodeURIComponent).join("/");
  };

  const request = async (method: "PUT" | "DELETE" | "GET", relativePath: string, init?: RequestInit) => {
    const signed = await client.sign(`${objectBase}/${key(relativePath)}`, { ...init, method });
    return send(signed);
  };

  const failure = async (action: string, relativePath: string, response: Response) => {
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
    return new Error(
      `Could not ${action} ${relativePath}: the bucket answered ${response.status}` +
        `${detail ? ` (${detail})` : ""}. Check the ASSETS_S3_* settings and the bucket's policy.`,
    );
  };

  return {
    driver: "s3",

    async put(relativePath, bytes, contentType) {
      const response = await request("PUT", relativePath, {
        body: bytes,
        headers: {
          "content-type": contentType,
          // Filenames are UUIDs and a stored file is never rewritten, so a
          // CDN in front of the bucket may keep it for as long as it likes.
          "cache-control": "public, max-age=31536000, immutable",
          ...(acl ? { "x-amz-acl": acl } : {}),
        },
      });
      if (!response.ok) throw await failure("upload", relativePath, response);
    },

    async get(relativePath) {
      const response = await request("GET", relativePath);
      if (!response.ok) throw await failure("read", relativePath, response);
      return Buffer.from(await response.arrayBuffer());
    },

    async delete(relativePath) {
      const response = await request("DELETE", relativePath);
      // Already gone is a success for our purposes, as ENOENT is on disk.
      if (!response.ok && response.status !== 404) {
        throw await failure("delete", relativePath, response);
      }
    },

    publicUrl: (relativePath) => `${publicBase}/${key(relativePath)}`,

    describe: () =>
      `Images: bucket ${bucket}${endpoint ? ` at ${trimSlash(endpoint)}` : ` in ${region}`}, served from ${publicBase}`,
  };
}

export const imageStore: ImageStore = objectStorage
  ? createS3Store(objectStorage)
  : createLocalStore(ASSETS_ROOT);

/**
 * Under the bucket driver, an image that is not on disk is in the bucket.
 *
 * Mounted at `/assets` behind the static handler, so the bundled demo images
 * and anything else on disk are served exactly as before, and everything else
 * is sent to where the bytes really are. One extra round trip per image per
 * browser, cached for as long as the static handler would have cached the
 * bytes — cheaper than a second URL base in the storefront, the SEO tags, the
 * emails and the CSV export. The path is validated the same way a stored one
 * is, so this cannot be used to redirect a browser to an arbitrary key.
 */
export const redirectToImageStore: RequestHandler = (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(req.path).replace(/^\/+/, "");
  } catch {
    next();
    return;
  }

  if (!isSafeRelativePath(relativePath)) {
    next();
    return;
  }

  res.set("Cache-Control", isProduction ? "public, max-age=2592000" : "no-cache");
  res.redirect(302, imageStore.publicUrl(relativePath));
};
