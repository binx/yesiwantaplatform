---
task: "25"
title: Object storage for uploaded images
status: done
tier: 2
size: M
migration: none
blocked_by: []
blocks: ["28"]
touches: server/image-store.ts · server/uploads.ts · server/env.ts · server/app.ts · server/index.ts · server/middleware.ts
completed: 2026-09-09
shipped_in: 27
summary: >-
  `ASSETS_DIR` (PR 9) lets one volume hold the database and the images, which is enough
  for a Droplet or Fly. It is not enough for any platform without a persistent disk, and
  it is the one thing forcing a volume onto a Postgres deployment that otherwise needs
  none. Put a storage interface behind `storeImage` and `deleteImageFile`, keep the
  filesystem driver as the default, and add an S3-compatible one. `/assets/<path>` stays
  the only URL anything builds: under the bucket driver the server answers it with a
  redirect.
---

# 25 · Object storage for uploaded images

`docs/site-plan.md` §8 lists this as the open question worth its own brief:
*the single thing standing between Beluga and the whole class of managed
platforms*. PR 9 closed the prerequisite. This is the brief.

## The problem

`server/uploads.ts` writes an original and up to four derivatives with
`writeFile` under `ASSETS_ROOT`, and `server/app.ts` serves that directory
with `express.static`. Every deployment therefore needs a filesystem that
survives a deploy, which rules out DigitalOcean App Platform, Heroku, Render's
lower tiers, and anything serverless — the site plan's §7.4 has the list and
the reasons. A store on managed Postgres still has to mount a volume for a
directory of WebP files, and that volume is why it cannot run two instances.

The site plan's own verdict is that "what must persist" should be the first
deploy page. This brief makes the answer *the database* rather than *the
database and a directory*.

## Scope, revised

The first draft of this brief was Large. It changed the URL browsers fetch
images from — `ASSETS_PUBLIC_URL/<path>` instead of `/assets/<path>` — which
meant an `assetBaseUrl` on the public store snapshot, every `assetUrl` call
site in the storefront and the admin, `absolute()` in `seo.ts`, the emails,
and seeding the bundled demo images into the bucket so a demo store had
pictures. None of that is the feature. It is the cost of one decision, and
a redirect removes it: the server keeps answering `/assets/<path>`, and under
the bucket driver answers it with a 302 to where the bytes are. One extra
request per image per browser, cached for as long as the bytes would have
been. The migration script and the site plan's platform list moved to task 28,
so this brief is the seam and the driver, and nothing that is not.

## What to build

### The seam

`server/image-store.ts`, with exactly the operations the code performs today:

```ts
interface ImageStore {
  readonly driver: "local" | "s3";
  put(relativePath: string, bytes: Buffer, contentType: string): Promise<void>;
  delete(relativePath: string): Promise<void>;
  /** Where a browser fetches it. Relative for the local store, absolute for a bucket. */
  publicUrl(relativePath: string): string;
  /** One line for the boot log. */
  describe(): string;
}
```

`storeImage` and `deleteImageFile` call the store instead of `fs`; the sharp
pipeline, the path guards and the derivative naming in `shared/images.ts` are
untouched, since they operate on `relativePath` strings before anything is
written. The traversal check stays, because a bucket key of `../x` is still a
key nobody should be able to choose; it becomes a check on the relative path
(`isSafeRelativePath`) that both drivers share, with the local driver's
resolved-prefix check behind it.

### Two drivers

- **`local`** — today's behaviour, selected when no bucket is configured. Writes
  under `ASSETS_ROOT`; `publicUrl` returns `/assets/<path>`.
- **`s3`** — selected by `ASSETS_S3_BUCKET`, with `ASSETS_S3_REGION`,
  `ASSETS_S3_ACCESS_KEY_ID`, `ASSETS_S3_SECRET_ACCESS_KEY` and
  `ASSETS_PUBLIC_URL` (the CDN or bucket origin) required, and
  `ASSETS_S3_ENDPOINT` and `ASSETS_S3_ACL` optional. S3-compatible covers AWS,
  DigitalOcean Spaces, Cloudflare R2, Backblaze and MinIO, which is why it is
  the one driver and not one per vendor. The signing library is `aws4fetch`,
  not `@aws-sdk/client-s3`: the driver needs PUT and DELETE, and the SDK's
  client is a larger install than the rest of the server's dependencies
  together, paid by every deployment including those that keep images on disk.

Validate the whole group in `server/env.ts` the way the rest of the file does:
a bucket with no credentials is a configuration error at boot, not a 500 at the
first upload — and so is a key with no bucket, which would otherwise write to
a disk the platform is about to lose. Boot prints which driver is active, next
to the existing "listening on" line, so the deploy log says where images are
going.

### The URL contract

The database stores `demo/tote-front.svg` and the storefront builds
`/assets/demo/tote-front.svg` in `assetUrl` (`src/lib/store-source.ts`). Both
stay exactly as they are. Under the bucket driver `server/app.ts` mounts a
handler at `/assets` *behind* the static one: a file on disk — the bundled demo
images, a self-hosted font sheet — is served as before, and anything else is
answered with a 302 to `publicUrl(path)`. Stored values stay relative, which
is what makes switching drivers a configuration change and not a data
migration.

The one thing the redirect does not remove: **`img-src` in the CSP**
(`server/middleware.ts`) must include the bucket origin when the driver is
active, because a CSP is checked against every hop of a redirect. Derive it
from `ASSETS_PUBLIC_URL`, the same way task 22 derives a font origin; the
header is byte-for-byte unchanged under the local driver.

## Out of scope

- **Moving an existing directory into a bucket**, and revising the site plan's
  ruled-out platforms once the driver has met a real bucket — task 28.
- Digital product files. `docs/gaps/digital-delivery.md` is explicit that a
  purchasable file must not be under a public path; a bucket with a public
  read policy is exactly that. When delivery is designed it will want a
  *private* store with signed URLs, which is a different interface.
- Image transformation at the edge. Derivatives are still generated at upload.
- Any vendor-specific driver.
- Seeding the demo images into the bucket. They are served from disk under
  both drivers, so there is nothing to seed.

## Definition of done

Per `docs/tasks/README.md`, plus:

- `server/assets-dir.test.ts` and `server/uploads.test.ts` pass unchanged: the
  local driver is the default and its behaviour is identical.
- A driver test with `fetch` stubbed, no network: an upload PUTs the original
  and each derivative with a Signature V4 header, a delete DELETEs all of them,
  a refused PUT is a failed upload rather than a half-stored image, and
  `publicUrl` is `ASSETS_PUBLIC_URL` plus the path.
- `/assets/<path>` redirects to the bucket, a file on disk is still served, a
  traversal is not redirected, and the CSP `img-src` carries the bucket origin
  under the driver and is unchanged otherwise.
- A boot test that a bucket without credentials fails with a message naming the
  missing variables, and that credentials without a bucket fail too.
- `.env.example` documents the group; the README **Images** section gains a
  paragraph.
