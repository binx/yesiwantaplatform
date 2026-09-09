---
task: "28"
title: Move an existing image directory into the bucket
status: todo
tier: 0
size: S
migration: none
blocked_by: ["25"]
blocks: []
touches: scripts/assets-migrate.ts · package.json · README.md · docs/site-plan.md
completed:
shipped_in:
summary: >-
  A store that has been running on a volume and switches to the bucket driver (task 25)
  has a directory of images the bucket has never seen. Add `npm run assets:migrate`: walk
  `ASSETS_ROOT` and `put` every file through the configured store, idempotently. The
  database is not touched, since stored paths are relative. Then revise the site plan's
  §7.4 list of ruled-out platforms, which the driver makes wrong.
---

# 28 · Move an existing image directory into the bucket

Split out of task 25, which ships the driver. Nothing here is needed for a
new store — it starts on whichever driver its environment names — so it is
its own small brief rather than a section of a larger one.

## What to build

### The script

`scripts/assets-migrate.ts`, run as `npm run assets:migrate`. It refuses to
run under the local driver (there is nowhere to migrate *to*), then walks
`ASSETS_ROOT` and calls `imageStore.put` for every file, with the content type
taken from the extension — the tree holds only what `storeImage` wrote, which
is `.webp` and `.gif`, plus whatever the bundled demo directory contains.

Idempotent: a HEAD against the key first, and skip one that exists with the
same `Content-Length`, so a run that was interrupted can simply be rerun. The
`ImageStore` interface has no `head`; add it to the `s3` driver only, or do the
check with a signed HEAD in the script. Print one line per file and a total.

The database is not touched. Stored paths are relative, and that was the point
of keeping them so.

### The order, documented

In the README's **Images** section, as a numbered list:

1. Configure the `ASSETS_S3_*` group and `ASSETS_PUBLIC_URL`.
2. Run `npm run assets:migrate` with the volume still mounted.
3. Redeploy and verify the storefront's images load from the bucket origin.
4. Drop the volume.

### The site plan

`docs/site-plan.md` §7.4 rules out App Platform, Heroku and Render's lower
tiers for the one reason task 25 removes. Revise the list once the driver has
been run against a real bucket — not before, since §8's own argument is that a
deploy claim made from inference has the same class of error as the build
blocker §7.2 found.

## Definition of done

Per `docs/tasks/README.md`, plus:

- A test that runs the script against a temporary `ASSETS_ROOT` with `fetch`
  stubbed the way `server/image-store.test.ts` does, and sees one PUT per
  file, and none on a second run.
- The README order above; the site plan revised.
