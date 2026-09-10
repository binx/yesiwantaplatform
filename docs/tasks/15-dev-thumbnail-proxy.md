---
task: "15"
title: "Dev only: freshly saved thumbnails render broken in the schedule"
status: done
tier: 3
size: S
migration: none
blocked_by: []
blocks: []
touches: vite.config.ts:66 · server/uploads.ts:205
completed: 2026-09-10
shipped_in: 17
summary: >-
  In `npm run dev`, the thumbnail of a design saved seconds ago shows as a broken
  image in the schedule. The Vite proxy's bypass sees the new file on disk and lets
  Vite serve it from public/, but Vite's cached list of public files has not caught
  up, so the request falls through to the SPA shell as text/html. Production serves
  assets from the API and is unaffected. Narrow the bypass to the paths it exists for.
---

# 15 · Dev only: freshly saved thumbnails render broken in the schedule

Found in the 2026-09-10 new-customer walkthrough, confirmed with a
response trace: the first `GET /assets/designs/<id>/thumb.webp` after a
save returned `200 text/html` (827 bytes, the SPA shell); a second request
seconds later returned `image/webp`. Effort: under an hour.

## The cause

`vite.config.ts:66`'s `bypass` returns the URL — "let Vite serve it" —
whenever `existsSync(path.join("public", url))`. The API has just written
the file to `public/assets/designs/…` (the default `ASSETS_DIR`), so the
check passes. But Vite's public-directory middleware answers from a set of
file names built at startup and updated by its watcher, and the watcher has
not fired yet, so the request misses `public/`, misses every other
middleware, and lands on the SPA fallback. The `<img>` gets HTML, decodes
nothing, and shows the broken-image glyph. The cart, rendered later, gets
the real file.

## What to build

- The bypass exists for one thing, per its own comment: the bundled
  `public/demo/` images. Make it say so:

  ```ts
  bypass: (req) => {
    const url = req.url?.split("?")[0] ?? "";
    return url.startsWith("/assets/demo/") && existsSync(path.join("public", url)) ? url : undefined;
  },
  ```

  Everything else under `/assets` — every uploaded design — is proxied to
  the API, which serves `ASSETS_DIR` itself and has the file the moment it
  has finished writing it.

- Check what the seed actually points product images at. `grep -rn
  "demo/" shared/demo-store.ts db/seed.ts public/` — if nothing under
  `public/demo` is referenced any more, delete the bypass entirely and the
  comment with it.

## Acceptance

- `npm run dev:all`, `/create`, save a design: the schedule thumbnail
  renders on the first paint, with a `200 image/webp` in the network tab.
- The landing page's bundled images (hero, table) still load in dev.
- `npm run build && npm start` unaffected (it never used the proxy).

## Tests to add

- None practical for the Vite config; the e2e suite already runs against
  `npm run dev:all`, and `e2e/storefront.spec.ts:36` waits for "Remove
  design 1" — extend that case with
  `await expect(page.locator("section[aria-labelledby=schedule-heading] img").first()).toHaveJSProperty("naturalWidth", 408)`
  (the thumbnail's width from `server/uploads.ts:170`), which fails today.
