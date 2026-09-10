---
task: "14"
title: "Shell: the card fonts are a dependency, and the footer stays down"
status: todo
tier: 0
size: S
migration: none
blocked_by: []
blocks: ["07"]
touches: server/html.ts:71 · index.html · src/App.tsx:38 · shared/postcards.ts:90 · src/index.css:51 · src/components/layout/Footer.module.css
completed:
shipped_in:
summary: >-
  The three faces a card can be set in, and Sacramento on the landing page, are only
  ever loaded because the default theme's Google Fonts URL happens to include them.
  With that URL blank — the demo store, or an admin who picks another font — the
  back-of-card preview renders in the browser's serif while the print uses Patrick
  Hand, and the landing headings fall back to Times. Load the card fonts always,
  separately from the theme. Also: short pages show a band of page-grey under the
  footer because nothing pushes it to the bottom.
---

# 14 · Shell: the card fonts are a dependency, and the footer stays down

Found in the 2026-09-10 new-customer walkthrough. Two parts, one PR.
Effort: two hours.

## A. Load the card fonts regardless of the theme

`BACK_FONTS` (`shared/postcards.ts:90`) says all three faces "load from
Google Fonts", but the only stylesheet the storefront ever requests is the
theme's `fontUrl` — injected by `server/html.ts:71` in production and by
`ThemeVars` in `src/App.tsx:38` at runtime. `defaultTheme.fontUrl`
(`shared/schema.ts:185`) lists Quicksand, Sacramento and Patrick Hand,
which is why this has looked fine on a wizard-set-up store. `demoStore`
sets `fontUrl: null` (`shared/demo-store.ts:15`), so `npm run db:seed`
gives a store where the preview lies: "Handwriting" renders as Times, and
the fit measurement brief 07 adds would be measuring the wrong face. An
admin who changes the font in Settings → Look to anything else breaks it
the same way, with no warning.

`print/back.hbs:5` loads its own three faces; the storefront should too.

- Add `CARD_FONTS_URL` to `shared/postcards.ts` next to `BACK_FONTS`:
  `https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Sacramento&family=Quicksand:wght@400;600&display=swap`.
  `back.hbs` should build its `<link>` from the same constant (it is a
  Handlebars template rendered in `server/lob.ts`; pass it in as a
  variable rather than duplicating the string).
- `server/html.ts`: always emit `<link rel="stylesheet" href="{CARD_FONTS_URL}">`
  with `id="beluga-card-fonts"`, before the theme link, plus the
  `preconnect` hints for `fonts.googleapis.com` and `fonts.gstatic.com` if
  they are not already there.
- `index.html`: the same link, so `npm run dev` matches production.
- `ThemeVars` leaves it alone: only the theme link is managed there.
- `LandingPage.module.css:82` (`.script`) keeps `Sacramento, cursive`; it
  now resolves.
- The admin theme editor's font-URL help text (`src/admin/ThemeEditor.tsx:308`)
  gets one sentence: "The postcard's own faces are always loaded; this URL
  is for the site's text."

The CSP, if the server sets one, must already allow `fonts.googleapis.com`
and `fonts.gstatic.com` for the theme link; confirm with a demo-store boot
and `document.fonts.check('16px "Patrick Hand"')` after `document.fonts.ready`
— it must be `true` *and* `[...document.fonts]` must contain the face
(`check` alone returns true for unknown families).

## B. The footer sits at the bottom of short pages

`body` is `--beluga-page` (`src/index.css:70`) and the footer is
`--beluga-surface` on top of a border; on `/cart` empty, `/account/login`
and the 404, the content plus footer is shorter than the viewport and a
darker band shows under the footer.

- `#root { min-height: 100dvh; display: flex; flex-direction: column; }`
  and `main { flex: 1 0 auto; }` in `src/index.css`. `ThemedShell`
  (`App.tsx`) already renders `Banner`, `main`, `Footer` as siblings under
  `#root`, so nothing in the tree changes.
- `.footer { margin-top: auto }` is not needed once `main` grows; leave
  the `4rem` margin for spacing.
- Check the `StoreErrorBoundary` fallback, which renders its own `<main>`
  without a footer, still fills the viewport.

## Acceptance

- On a store seeded with `npm run db:seed` (fontUrl null), the back-of-card
  preview at `/create` renders "Handwriting" in Patrick Hand and "Script" in
  Sacramento; the landing page's "Information" heading is in Sacramento.
- Network tab on `/`: the card-fonts stylesheet is requested exactly once,
  in dev and in `npm run build && npm start`.
- `/cart` empty, on a 1280 × 800 viewport: no page-coloured band below the
  footer; the footer's bottom edge is the viewport's bottom edge.

## Tests to add

- The existing test of the HTML handler (`server/html.ts` is covered from `server/seo.test.ts` or `server/app.test.ts`; add one if neither does): the
  response contains the card-fonts link whether or not the store has a
  `fontUrl`.
- `e2e/storefront.spec.ts`: on `/create`, `await page.evaluate(() =>
  document.fonts.ready.then(() => [...document.fonts].some((f) =>
  f.family === "Patrick Hand" && f.status === "loaded")))` is true.
- A Playwright screenshot assertion is overkill for the footer; a
  `boundingBox()` check that the footer's bottom equals the viewport
  height on `/cart` is enough.

## Out of scope

- Self-hosting the fonts. Worth it for privacy and for Lob's renderer
  (see `docs/NEXT-STEPS.md` §1) but a separate decision.
