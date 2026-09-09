---
task: "22"
title: Web fonts that load, and a locale for the numbers
status: todo
tier: 1
size: M
migration: two columns on store_settings
blocked_by: []
blocks: []
touches: src/admin/ThemeEditor.tsx · server/middleware.ts · index.html · shared/money.ts · shared/schema.ts
completed:
shipped_in:
summary: >-
  Settings offers a font stack, but the production CSP allows fonts and stylesheets from
  `'self'` only, so a Google Fonts link or a self-hosted `@font-face` fails silently and
  nothing tells the merchant why. And every price is formatted `en-US` regardless of
  currency, so a EUR store prints `€1,234.56`. Add a font source the theme can load and
  the CSP allows, and a store locale that money, dates and country names all read.
---

# 22 · Web fonts that load, and a locale for the numbers

Two things a merchant sets up on day one that the admin appears to support and
the server quietly undoes.

## The problem

**Fonts.** *Look → Typeface* offers a preset list and a *Custom…* font stack
(`src/admin/ThemeEditor.tsx:173`). The stack reaches CSS as `--beluga-*` tokens
and antd's `fontFamily`, which is right. But nothing loads a font file. A
merchant who types `"Fraunces", serif` sees Fraunces only on a machine that has
it installed, and the obvious next step — a `<link>` to Google Fonts in
`index.html`, or `@font-face` in `index.css` — is blocked in production by the
CSP in `server/middleware.ts:37`: `styleSrc` and `fontSrc` are `'self'` (plus
`'unsafe-inline'` and `data:`), so the stylesheet request is refused and the
font falls back to the next stack entry with a console error only a developer
would find. The theme editor, the README's theme section and `.env.example` say
nothing about it.

**Locale.** `formatMoney` (`shared/money.ts:27`) defaults `locale` to `"en-US"`
and all seventeen callers accept the default. A store whose currency is EUR
prints `€1,234.56`, GBP prints `£1,234.56`; a German shop expects `1.234,56 €`.
Dates in the account area use `toLocaleDateString()` with no argument — the
browser's locale, which is the buyer's, not the store's — while the admin's
`orderPresentation.ts` uses `Intl.DateTimeFormat(undefined, …)`. `countryName`
in `shared/shipping.ts:261` takes a locale and is never passed one. Three
different answers to "what language is this store in", none of them the
merchant's.

## What to build

### 1 · A font the theme can load

Add `theme_font_url` (nullable text) to `store_settings` and `fontUrl` to
`themeSchema`. It is the URL of a stylesheet that defines the faces in
`fontFamily`: for Google Fonts, the `css2?family=…` link; for a self-hosted
font, a stylesheet under `/assets/…` uploaded like any image. Validate as
`https://` or a same-origin `/assets/` path.

**Loading it.** The storefront's shell (`index.html`) cannot know the value at
build time. `ThemeVars` in `src/App.tsx` already publishes the theme to
`:root` after the store loads; have it also insert `<link rel="stylesheet">`
for `fontUrl` when set, and remove it when cleared. In production the HTML
handler (`server/app.ts`) rewrites the head for every page already; add the
same `<link>` there, plus `<link rel="preconnect">` for its origin, so the
font starts loading before React boots.

**The CSP.** Extend `styleSrc` and `fontSrc` with the origin of `fontUrl`,
computed per request from the settings the HTML handler already loads — not a
hardcoded Google allow-list, since self-hosted fonts and other providers are
the point. `helmet` accepts a function for a directive value. Keep `'self'`;
add exactly one origin. When `fontUrl` is null, the header is byte-for-byte
what it is today. Note that Google Fonts serves the stylesheet from
`fonts.googleapis.com` and the files from `fonts.gstatic.com`: both origins are
needed, and the second is not in the URL. Resolve it by fetching the stylesheet
once on the server and reading the `url()`s, cached per `fontUrl`; that also
turns a typo into an error at save time rather than a blank font at run time.

**The editor.** Under *Font stack*, a *Font stylesheet URL* field with help:
*Where the browser loads the typeface from. For Google Fonts, paste the
`<link href>`. Leave empty for a system font.* The preview at the bottom of
Settings should load it too, so the merchant sees the face before saving.

### 2 · A store locale

Add `locale` (text, default `"en-US"`, BCP 47) to `store_settings`, to
`storeSchema` next to `currency`, and to *Settings → Identity* under Currency
as a select of common tags with a free-text fallback, validated with
`Intl.getCanonicalLocales`. Then:

- `formatMoney(cents, currency, locale)` — thread the store locale through
  every caller. The storefront reads it from `useStore()`; emails and the
  server from `getSettings()`. Keep the default so tests that pass two
  arguments still pass.
- The account pages' two `toLocaleDateString()` calls and
  `orderPresentation.ts`'s `Intl.DateTimeFormat(undefined, …)` take the store
  locale.
- `countryName(code, locale)` gets it from the cart and the shipping admin.
- `<html lang>` — set from the locale's language subtag in the production HTML
  handler, and by `ThemeVars` on the client, so screen readers and translation
  prompts get the right answer.

The CSV exports keep `*_cents` integers and are unaffected.

## Out of scope

- Translating the storefront's strings. This brief makes the numbers and the
  document language right; a string catalogue is its own, much larger, brief.
- Per-buyer locale. The store picks one, the way it picks one currency and one
  colour scheme; a shop's look and its prices read the same in every screenshot.
- Uploading font files through the admin. A self-hosted font is a stylesheet
  under `/assets/`, put there by the developer; the field just points at it.

## Definition of done

Per `docs/tasks/README.md`, plus:

- Both dialects, both migration folders.
- A server test that the CSP header is unchanged when `fontUrl` is null, and
  carries exactly the stylesheet's origin and the resolved file origin when it
  is set.
- A test that a `fontUrl` whose stylesheet cannot be fetched is refused at save
  with a message naming the URL.
- `shared/money.test.ts` covers `de-DE` with EUR and `en-GB` with GBP.
- A component test that a store with `locale: "de-DE"` renders a price with a
  comma decimal on the product page.
- README theme section explains the font URL and the CSP consequence in two
  sentences.
