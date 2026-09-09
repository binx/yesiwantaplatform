---
task: "33"
title: Storefront fixes from a blank-store run
status: done
tier: 0
size: M
migration: none
blocked_by: []
blocks: []
touches: src/components/product/Carousel.module.css:10 · src/components/product/Carousel.tsx:23 · src/index.css · src/components/layout/StorefrontGate.tsx:76 · src/pages/LandingPage.tsx:93 · src/admin/ThemeEditor.tsx:240 · e2e/accessibility.spec.ts
completed: 2026-09-09
shipped_in: 34
summary: >-
  What a shopper sees on a store whose images were not all the same shape. The product
  gallery takes the height of its tallest image, so a landscape photo next to a portrait
  one sits over a large grey void; the password gate and the pre-setup welcome page render
  in the browser's default serif; the landing page's collection tile ignores the cover
  `/shop` shows; and three controls have no accessible name. Plus a typeface picker that
  lets a merchant load a web font and never use it.
---

# 33 · Storefront fixes from a blank-store run

The demo catalogue's images are all the same shape, which is why none of this
showed before. The review uploaded a 4:3 mug, a 5:8 plate (EXIF-rotated, which
the upload handled correctly) and a 3:4 bowl, and then looked.

## 1 · The gallery is as tall as its tallest image

**Files:** `src/components/product/Carousel.module.css:10`,
`src/components/product/Carousel.tsx`

`.track` is a horizontal scroll-snap flex row, and each `.slide` is as tall as
its image. Flex stretches every slide to the tallest, so on a product with a
landscape first image and a portrait second, the first slide is a 4:3 image
over a grey block twice its height — the review's screenshot shows the mug
sitting on 500 px of nothing. The thumbnails are fine; it is only the main
frame.

Give every slide the same frame and fit the image inside it:

- `.slide` gets `aspect-ratio: 4 / 5` (or 1 / 1 — pick one and use it for the
  `/shop` card too, so the two agree) and `overflow: hidden`.
- The image inside gets `width: 100%; height: 100%; object-fit: contain`,
  on the page surface colour so letterboxing reads as intentional.
- The track's height is then the frame's, whatever is in it.

`Image.PreviewGroup` (zoom) shows the full image regardless, so nothing is
lost by containing the inline one. Update `Carousel.test.tsx` to assert the
slide class rather than the image's intrinsic size, since jsdom does not lay
out.

## 2 · Two pages render outside the theme

**Files:** `src/index.css`, `src/components/layout/StorefrontGate.tsx:76`,
`src/admin/SetupPage.tsx` (the welcome screen)

`ThemeVars` (`src/App.tsx:35`) writes the store's font stack onto the
document, and it runs inside `ThemedShell`, which needs `/api/store`. The
password gate renders when that request answers 401, and the pre-setup
welcome when it answers 503, so neither ever gets a font: both fall back to the
browser default and render *This store is not open yet* in Times. The gate is
the first thing a merchant's client sees when they are sent a preview link.

Set the base system font stack on `body` in `src/index.css` — the same stack
the `System` typeface preset uses — so anything outside the theme still reads
as the app. `ThemeVars` overrides it once the store loads; nothing themed
changes.

## 3 · The landing page's collection tile ignores the cover

**File:** `src/pages/LandingPage.tsx:93`, `src/pages/ShopPage.tsx`

`/shop` renders a collection as its cover at 16:9 with the name beneath. The
landing page renders the same collection as a white box with the name
centred, cover or no cover — on a dark scheme, a dark box. With covers now
editable (task 21) the two should agree. Reuse the shop tile, or extract it
into `src/components/product/CollectionTile.tsx` and use it in both places.
Keep the text-only card as the fallback when a collection has no cover; it is
what a brand-new store shows.

## 4 · Three controls have no accessible name

**Files:** `src/components/layout/StorefrontGate.tsx:89`,
`src/admin/ThemeEditor.tsx:240`, `src/components/product/Carousel.tsx`

- The gate's `Input.Password` has a placeholder and nothing else.
  `getByLabel(/password/)` finds nothing. Give it `aria-label="Password"`, or
  a visible label — the field is the whole page.
- **Font stylesheet URL** in the theme editor is a `Form.Item` whose label is
  not wired to its input (`getByLabel` returns zero elements). Do what the
  `Typeface` item three fields up does: `useId`, `htmlFor`, `id`. The
  comment on that item (`ThemeEditor.tsx:207`) explains why the visible
  label alone is decorative.
- antd's `Image` preview mask is a `role="button"` with no name; axe reports
  `aria-command-name` (serious) on every product page with a zoomable image.
  Pass `preview={{ mask: <span>Zoom</span> }}` or an `aria-label` through
  the wrapper so the button says what it does.

Axe did not catch the first two because it accepts a placeholder as a name
for the `label` rule. Playwright's `getByLabel` does not, and neither does a
screen reader user who has cleared the field.

## 5 · A font URL that nothing uses

**File:** `src/admin/ThemeEditor.tsx:240`

A merchant pastes a Google Fonts URL for *Fraunces*, leaves **Typeface** on
*Serif*, saves, and the storefront downloads Fraunces on every page and
renders Georgia. The review did this by accident. The URL and the stack are
two fields with no relationship between them, and nothing says so.

When the URL parses as a Google Fonts `css2` URL, read the `family=` names
out of it and, if none of them appears in the selected stack, show a hint
under the URL field — *This stylesheet defines Fraunces, which the typeface
above does not use.* — with a button that switches Typeface to *Custom…*
prefilled as `"Fraunces", <current stack>`. For any other URL, the hint
cannot know the family; say nothing.

## Out of scope

- Palette and contrast in the dark scheme. Real, seen, and deliberately not
  here — task 34 derives a scheme-adjusted primary.
- A different gallery interaction. Scroll-snap plus thumbnails plus zoom is
  fine; only the frame changes.

## Definition of done

Per `docs/tasks/README.md`, plus:

- `e2e/accessibility.spec.ts` runs axe against a product with two images of
  different shapes (seed one in `db/seed.ts`'s demo catalogue), against the
  theme editor, and against the gate — `e2e/storefront-lock.spec.ts` already
  locks the store for its run and is where the gate check belongs.
- `Carousel.test.tsx` covers the frame class on every slide.
- A screenshot of the mug page before and after in the PR. This is a visual
  fix and the test cannot see it.
