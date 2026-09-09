---
task: "34"
title: A primary colour that survives the dark scheme
status: todo
tier: 0
size: M
migration: none
blocked_by: []
blocks: []
touches: src/lib/theme.ts:115 · src/lib/theme.test.ts · src/admin/ThemeEditor.tsx:78 · src/admin/adminTheme.ts · src/admin/ProductsPage.tsx:194 · src/admin/ProductEditorPage.module.css:144 · src/components/layout/Footer.module.css:9
completed:
shipped_in:
summary: >-
  Switch a store to **Dark** with the default primary and every primary button — *Add to
  cart*, *Checkout*, the hero's call to action — is `#18181b` on `#0c0a09`. The theme editor
  already computes that ratio and warns; this brief has the theme *fix* it instead, by
  deriving a scheme-adjusted primary that clears 3:1 against the page, with the arithmetic
  guaranteed in `theme.test.ts`. Also the three admin tags axe flagged, and the seam under
  the footer on short pages.
---

# 34 · A primary colour that survives the dark scheme

Decided: **derive**. The merchant keeps one primary colour, and Beluga adjusts
it per scheme when it has to, saying so in the editor. The alternatives — a
second *Primary (dark)* field, or leaving the existing warning to do the work
— were considered in the gap this brief replaces. A second field is a
migration and one more thing to set for a case most stores never hit; a
warning alone shipped a default theme whose most important button is
invisible. Derivation costs a function and a test and makes the default
right.

## What was seen

Store set to **Dark**, primary and accent left at their defaults.

- *Add to cart*, *Checkout*, *Browse the shop* and the hero button render
  `#18181b` on the `#0c0a09` page — 1.2:1. Findable by their text, just.
- On a short page (an empty cart) the body colour shows beneath the footer as
  a band, because the footer paints `--beluga-surface` and the shell does not
  fill the viewport. Invisible in the light scheme, where the two colours are
  close.

And in the admin's own (light, untouched) theme, from axe at `wcag2aa`,
serious:

- `.ant-tag-error` filled — *Live · not published* on the products list.
- `._slugPrefix_*` — the `/product/` prefix in the editor, `#a1a1aa` on white,
  2.5:1.
- `.ant-tag-green` filled — *webhooks on* under Stripe in Settings.

## 1 · Derive the primary per scheme

**Files:** `src/lib/theme.ts:115` (`themeCssVars`), `:139` (`toAntdTheme`)

Add one function beside `effectivePageColor`:

```ts
/** The primary as painted: the merchant's colour, pushed toward the scheme's
 *  ink until it clears UI_CONTRAST against both page and surface. */
export function effectivePrimary(theme: Theme): string
```

- `UI_CONTRAST = 3` — WCAG 1.4.11's ratio for user-interface components and
  graphical objects. A button *fill* against the page is exactly that; the
  label on the fill is a separate question `readableOn` already answers at
  4.5:1.
- Test the merchant's colour against `effectivePageColor(theme)` **and**
  `schemePalette[scheme].surface` (cards paint buttons too). If both clear,
  return it unchanged — a colour that works is never touched.
- Otherwise `mix` toward the scheme's ink (`#fafaf9` in dark, `#18181b` in
  light) in steps of a few percent until both clear, and return that. Mixing
  toward ink keeps the hue and gives up saturation, which is the right trade:
  a lifted charcoal still reads as "this store's black", where a hue shift
  would not. Cap the loop; at 100 % ink it clears by construction.
- Do the same for the accent. `#e07a5f` clears in both schemes today, but a
  merchant's pick may not, and the sale badge is a graphical object too.

Then use it. `themeCssVars` writes `effectivePrimary(theme)` to
`--beluga-primary` and feeds it to `readableOn` for `--beluga-on-primary`;
`toAntdTheme` passes it as `colorPrimary`, `colorInfo`, `colorLink` and into
the two `mix` calls. `theme.colorPrimary` itself is not modified anywhere —
it is what the merchant chose and what the editor's picker shows. Email
(`server/email.ts`) keeps using the raw accent: a mail client has no scheme.

## 2 · The editor says what happened

**File:** `src/admin/ThemeEditor.tsx:78`, `:130`

The editor already computes `primaryContrast` against the page and shows a
warning below `MIN_CONTRAST`. Once the theme derives, the warning is stale:
the buttons no longer disappear. Replace it with a note that appears only
when `effectivePrimary(value) !== value.colorPrimary`: *Buttons use
`#3a3a3f` in the dark scheme so they stay visible against the page; your
`#18181b` is kept for the light scheme and for email.* Show the derived swatch
beside the picker. The live preview (`ProductCard` under the real theme,
`:289`) renders the derived colour automatically once group 1 lands, because
it goes through `themeCssVars` like the storefront does.

## 3 · Admin contrast

**Files:** `src/admin/adminTheme.ts`, `src/admin/ProductsPage.tsx:194`,
`src/admin/SettingsPage.tsx:306`, `src/admin/ProductEditorPage.module.css:144`

The admin is deliberately not the merchant's theme (see the comment at the
top of `adminTheme.ts`), so these are fixed in Beluga's own tokens:

- Filled status tags. antd's `color="error"` / `"green"` fills use red-1 /
  green-1 behind red-6 / green-6 text and land near 4:1. Either move the
  text tokens (`colorErrorText`, `colorSuccessText`, `colorWarningText`) one
  step darker in `adminTheme` — red-7 `#cf1322` is 5.2:1 on white — or render
  these tags `variant="outlined"` on the white table row, where the darker
  text alone carries the meaning. Pick one and apply it to every status tag
  in `ProductsPage` and `SettingsPage`; do not fix them one by one.
- `.slugPrefix` uses `#a1a1aa`, the *dark* palette's muted. The light muted
  `#71717a` is 4.8:1 on white and is the colour the rest of the admin uses
  for secondary text. Use it — via a variable, not another literal.

## 4 · The seam under the footer

**Files:** `src/components/layout/Footer.module.css:9`, `src/index.css:53`,
`src/components/layout/PageWrapper.module.css`

Make the shell fill the viewport — `min-height: 100dvh` on the app root with
the main column growing — so the footer sits at the bottom and the page
colour never shows beneath it. Fixing it in layout rather than by painting
the footer the page colour keeps the footer's surface distinct, which is the
design.

## Out of scope

- A second primary colour field. Rejected above.
- Deriving anything else per scheme. `ink`, `muted`, `line`, `surface` and
  `page` are already per-scheme; the primary and accent were the two values
  that were not.
- The storefront gate and welcome pages, which render before any theme
  exists — task 33 covers them.

## Definition of done

Per `docs/tasks/README.md`, plus, in `src/lib/theme.test.ts`:

- The default theme in **dark** has `--beluga-primary` at ≥ 3:1 against both
  `--beluga-page` and `--beluga-surface`, and `--beluga-on-primary` at ≥ 4.5:1
  against it.
- The default theme in **light** returns `#18181b` unchanged — `effectivePrimary`
  is the identity for a colour that already clears.
- A sweep: for a grid of hex colours (every 0x33 step per channel is 216
  colours) in both schemes, `effectivePrimary` clears 3:1 against page and
  surface. This is the guarantee; it must not be a single example.
- A new `src/admin/adminTheme.test.ts` asserts the status-tag text tokens at
  ≥ 4.5:1 on white and on the table's row colour.
- Screenshots of the dark cart page and the dark product page in the PR,
  before and after — both the button and the footer seam are visual.
