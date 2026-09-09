---
task: "25"
title: Object storage for uploaded images
status: todo
tier: 2
size: L
migration: none
blocked_by: []
blocks: []
touches: server/uploads.ts · server/app.ts · server/env.ts · shared/images.ts · src/lib/store-source.ts
completed:
shipped_in:
summary: >-
  `ASSETS_DIR` (PR 9) lets one volume hold the database and the images, which is enough
  for a Droplet or Fly. It is not enough for any platform without a persistent disk, and
  it is the one thing forcing a volume onto a Postgres deployment that otherwise needs
  none. Put a storage interface behind `storeImage` and `deleteImageFile`, keep the
  filesystem driver as the default, and add an S3-compatible one. The URL contract
  `/assets/<path>` does not change.
---

# 25 · Object storage for uploaded images

`docs/site-plan.md` §8 lists this as the open question worth its own brief:
*the single thing standing between Beluga and the whole class of managed
platforms*. PR 9 closed the prerequisite. This is the brief.

## The problem

`server/uploads.ts` writes an original and up to four derivatives with
`writeFile` under `ASSETS_ROOT`, and `server/app.ts:92` serves that directory
with `express.static`. Every deployment therefore needs a filesystem that
survives a deploy, which rules out DigitalOcean App Platform, Heroku, Render's
lower tiers, and anything serverless — the site plan's §7.4 has the list and
the reasons. A store on managed Postgres still has to mount a volume for a
directory of WebP files, and that volume is why it cannot run two instances.

The site plan's own verdict is that "what must persist" should be the first
deploy page. This brief makes the answer *the database* rather than *the
database and a directory*.

## What to build

### The seam

An `ImageStore` interface in `server/uploads.ts`, with exactly the operations
the code performs today:

```ts
interface ImageStore {
  put(relativePath: string, bytes: Buffer, contentType: string): Promise<void>;
  delete(relativePath: string): Promise<void>;
  /** Where a browser fetches it. Relative for the local store, absolute for a bucket. */
  publicUrl(relativePath: string): string;
}
```

`storeImage` and `deleteImageFile` call the store instead of `fs`; the sharp
pipeline, the path guards and the derivative naming in `shared/images.ts` are
untouched, since they operate on `relativePath` strings before anything is
written. The traversal check stays, because a bucket key of `../x` is still a
key nobody should be able to choose.

### Two drivers

- **`local`** — today's behaviour, selected when no bucket is configured. Writes
  under `ASSETS_ROOT`; `publicUrl` returns `/assets/<path>`.
- **`s3`** — selected by `ASSETS_S3_BUCKET`, with `ASSETS_S3_ENDPOINT`,
  `ASSETS_S3_REGION`, `ASSETS_S3_ACCESS_KEY_ID`, `ASSETS_S3_SECRET_ACCESS_KEY`
  and `ASSETS_PUBLIC_URL` (the CDN or bucket origin). S3-compatible covers AWS,
  DigitalOcean Spaces, Cloudflare R2, Backblaze and MinIO, which is why it is
  the one driver and not one per vendor. Use `@aws-sdk/client-s3` and nothing
  else from that family; it is the only new dependency.

Validate the whole group in `server/env.ts` the way the rest of the file does:
a bucket with no credentials is a configuration error at boot, not a 500 at the
first upload. Boot prints which driver is active, next to the existing
"listening on" line, so the deploy log says where images are going.

### The URL contract

Today the database stores `demo/tote-front.svg` and the storefront builds
`/assets/demo/tote-front.svg` in `assetUrl` (`src/lib/store-source.ts`). Keep
the stored value relative — it is what makes switching drivers a configuration
change and not a data migration. Add `assetBaseUrl` to the public store
snapshot (`storeSchema`), `"/assets"` for local and `ASSETS_PUBLIC_URL` for
S3, and have `assetUrl` and the server's `absolute()` in `seo.ts` read it. The
emails already use absolute URLs from `PUBLIC_URL`; they read the same value.

Two consequences to state in the PR:

- **`imgSrc` in the CSP** (`server/middleware.ts`) must include the bucket
  origin when S3 is active. Derive it from `ASSETS_PUBLIC_URL`, the same way
  task 22 derives a font origin.
- **The bundled demo images** live in `public/assets/demo/` and are served from
  `dist` in production. They keep working under the local driver. Under S3
  they are not in the bucket; the seed should upload them through the store on
  first run, so a demo store on a managed platform still has pictures.

### Migrating an existing store

A script, `npm run assets:migrate`, that walks `ASSETS_ROOT` and `put`s every
file into the configured bucket, idempotently — skip a key that exists with
the same size. The database is not touched, since paths are relative. Document
the order: configure the bucket, run the script, redeploy, verify, then drop
the volume.

## Out of scope

- Digital product files. `docs/gaps/digital-delivery.md` is explicit that a
  purchasable file must not be under a public path; a bucket with a public
  read policy is exactly that. When delivery is designed it will want a
  *private* store with signed URLs, which is a different interface.
- Image transformation at the edge. Derivatives are still generated at upload.
- Any vendor-specific driver.

## Definition of done

Per `docs/tasks/README.md`, plus:

- `server/assets-dir.test.ts` still passes unchanged: the local driver is the
  default and its behaviour is identical.
- A driver test against MinIO or the SDK's mock: an upload puts the original
  and each derivative, a delete removes all of them, and `publicUrl` is
  `ASSETS_PUBLIC_URL` plus the path.
- A boot test that a bucket without credentials fails with a message naming the
  missing variable.
- The CSP `img-src` carries the bucket origin when S3 is active and is
  unchanged otherwise.
- `.env.example` documents the group; the README **Images** section gains a
  paragraph; `docs/site-plan.md` §7.4's ruled-out list is revised, since
  App Platform, Heroku and Render become workable.
