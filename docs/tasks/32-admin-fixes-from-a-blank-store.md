---
task: "32"
title: Admin fixes from a blank-store run
status: done
tier: 0
size: S
migration: none
blocked_by: []
blocks: []
touches: src/admin/CollectionsPage.module.css:68 · src/admin/CollectionsPage.tsx:383 · src/admin/ShippingPage.tsx:239 · src/admin/ShippingPage.tsx:369 · vite.config.ts:49 · src/admin/*.tsx (Alert)
completed: 2026-09-09
shipped_in: 32
summary: >-
  Five small things a merchant meets while filling an empty store. The collection cover
  preview renders 320 px wide and 1200 px tall; a collection introduction is lost unless
  the field is blurred, and nothing on that page says whether anything saved; typing a
  country name into a shipping zone silently does nothing; the rates' Zone select warns
  about a `null` option; and with a custom `ASSETS_DIR` every uploaded image 404s in
  development because Vite only proxies `/api`.
---

# 32 · Admin fixes from a blank-store run

Observed while setting up a store from nothing: three products, a collection,
a page, shipping, in a headless browser with screenshots. None is a feature.
Independent groups; land them in any order.

## 1 · The collection cover preview is squashed

**Files:** `src/admin/CollectionsPage.module.css:68`,
`src/admin/CollectionsPage.tsx:220`

`.coverImage` sets `width: 100%; max-width: 20rem; aspect-ratio: 16 / 9;
object-fit: cover`, and the comment says it frames the cover the way the
`/shop` tile does. The `<img>` also carries `width={cover.width}
height={cover.height}` — 1600 × 1200 for a landscape upload — and a
presentational `height` attribute means the height is no longer `auto`, so
`aspect-ratio` is ignored. Result: 320 px wide by 1200 px tall, with
`object-fit: cover` cropping a vertical strip out of the middle.

Add `height: auto` to `.coverImage`. Keep the attributes — they are what stop
the layout shifting while the image loads, and the `/shop` tile
(`ProductImage`) sizes the same way; check it does not have the same bug.

## 2 · The introduction saves on blur, silently

**File:** `src/admin/CollectionsPage.tsx:383`

`CollectionDescription` keeps local state and saves on blur, for the reasons
its comment gives — a request per keystroke would flood, and the refetch would
move the cursor. Both are right. But blur is the *only* trigger: type an
introduction, reload or close the tab, and it is gone. The review lost it
three times before working out why. And nothing on the collections page ever
says *Saved* — not for the introduction, not for the cover, not for the
product list. Products and pages both show a `SaveIndicator`; collections are
the one autosaving editor that does not.

Use the hook that already exists. `useAutosave` (`src/admin/useAutosave.ts`)
debounces, never overtakes an in-flight save, and reports `state`. Drive the
introduction through it with the field's local text as `value`, keep the blur
save as a `flush()`, and render a `SaveIndicator` in each card's header
(`extra`) fed by that hook. The refetch-moves-the-cursor problem is what
`markSaved` is for: the hook already distinguishes "the server's copy changed
because I saved it" from "it changed under me".

## 3 · Countries only accept codes, and say nothing otherwise

**File:** `src/admin/ShippingPage.tsx:239`

The zone's Countries field is a `mode="tags"` Select whose `onChange` upper-
cases each token and drops anything that is not two letters. The placeholder
hints at codes (`US, GB, DE…`), but a merchant who types *canada* and presses
Enter gets nothing at all — no tag, no message. The review did exactly that.

Two changes:

- **Accept names.** `countryName(code, locale)` already exists
  (`shared/locale.ts`); build the reverse map once per locale over the ISO
  list the cart's country select uses, and match a typed token
  case-insensitively against it before giving up. *canada* → `CA`.
- **Say when a token was dropped.** Set a transient `help` on the `Field` —
  *"xyz" is not a country. Use the two-letter code, like CA for Canada.* —
  cleared on the next change.

## 4 · A `null` option value in the Zone select

**File:** `src/admin/ShippingPage.tsx:369`

`{ label: "Everywhere", value: null }` makes antd warn `value in Select
options should not be null` on every render of the shipping page. Use a
sentinel string (`""`) for the option and map it to `null` in `onChange` and
back in `value`. The saved shape does not change.

## 5 · Development proxies `/api` and nothing else

**File:** `vite.config.ts:49`

The dev server proxies `/api` to the API and serves everything else itself.
Uploaded images are served by the API at `/assets/<path>` from `ASSETS_DIR`,
which works in dev only because the default `ASSETS_DIR` is `public/assets`
and Vite happens to serve `public/`. Set `ASSETS_DIR` to anything else — a
volume path, a scratch directory — and every uploaded image 404s in `npm run
dev:all` with Vite returning the SPA shell for the image URL. `/robots.txt`
and `/sitemap.xml` are the same: `siteRouter` never runs in dev, and Vite
returns the shell for both.

Proxy `/assets`, `/robots.txt` and `/sitemap.xml` to the API as well. For
`/assets`, use the proxy's `bypass` to let Vite keep serving a path that
exists under `public/` (the bundled `demo/` images) and forward everything
else. Say in `.env.example`, next to `ASSETS_DIR`, that the dev server now
follows it.

## 6 · antd's `Alert` API moved

**Files:** every `<Alert message=` in `src/`

antd 6 renamed `Alert`'s `message` prop to `title` and logs a deprecation
warning on every page that renders one — the review saw it on the wizard,
the overview and the product editor. Mechanical rename; there are around
fifty `Alert`s, not all of which use `message`. `grep -rn "<Alert" src` and
fix the ones that do. Stop when the console is quiet.

## Out of scope

- A save indicator on the shipping page. It has an explicit Save button and
  a success toast, which is a different, correct model.
- Reworking the Countries field into a full picker. Names-or-codes plus a
  hint is the whole ask.

## Definition of done

Per `docs/tasks/README.md`, plus:

- Group 2: a component test in `src/admin/CollectionsPage.test.tsx` (new)
  that types an introduction, advances timers past the debounce, and sees
  the `PUT`; and one that sees *Saved* afterwards.
- Group 3: a unit test for the name→code lookup in `shared/locale.test.ts`.
- Group 5: the dev-proxy change verified by hand with a non-default
  `ASSETS_DIR`; note the check in the PR.
- No console warnings from antd on any admin page.
