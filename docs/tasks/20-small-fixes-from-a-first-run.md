---
task: "20"
title: Small fixes a first run turned up
status: todo
tier: 0
size: S
migration: none
blocked_by: []
blocks: []
touches: src/App.tsx · src/pages/ProductPage.tsx · server/app.ts · server/seo.ts · src/lib/account.ts · src/admin/ProductEditorPage.tsx
completed:
shipped_in:
summary: >-
  Five things a developer meets in the first ten minutes, none of them large. The
  production HTML sends `Canvas Tote · Store` and the client overwrites it with the store
  name; a draft product URL answers 200 with the generic shell; every storefront page logs
  a 401 to the console and fetches the store twice; a brand-new product opens with three
  red errors before anything is typed. Independent groups, land them in any order.
---

# 20 · Small fixes a first run turned up

Observed against a seeded store in both `npm run dev:all` and the compiled
production build. Nothing here is a feature; each is a place where the app is
slightly less trustworthy than it looks.

## 1 · Product and collection pages lose their title

**Files:** `src/App.tsx:17`, `src/pages/ProductPage.tsx`,
`src/pages/CollectionPage.tsx`, `src/pages/ShopPage.tsx`

The production HTML handler writes `Canvas Tote · Fresh Test Store` into
`<title>` (`server/seo.ts`). Then React boots, `DocumentTitle` in `App.tsx` sets
`document.title = store.name`, and the tab reads *Fresh Test Store* on every
page. The server-side work is undone on hydration; bookmarks, history and the
tab strip lose the product name. `PagePage` and the account pages already set
their own titles; products, collections and the shop do not.

Set the title from the route: `Canvas Tote · Store` on a product, `Home Goods ·
Store` on a collection, `Shop · Store` on `/shop`, using the same `name ·
store` shape `server/seo.ts` produces so the two agree. Keep `DocumentTitle` as
the default for routes that set nothing. A shared `useDocumentTitle(title)`
hook is smaller than four `useEffect`s.

## 2 · Unknown and draft product URLs answer 200

**Files:** `server/app.ts:120`, `server/seo.ts:89`

`metaForPath` falls back to the store defaults for a slug it cannot find, and
the handler sends the shell with `200`. React then renders `NotFoundPage`, but
crawlers index the URL as a live page with the store's generic title. A draft
product — `isLive: false` — hits the same path: `findProductBySlug` finds it,
so the head is even built from the draft's name and description, and the
storefront then refuses to render it (`ProductPage.tsx:20`). That leaks a
draft's copy to anyone who guesses the slug, and to search engines.

Have `metaForPath` return a `status` alongside the meta: `404` for a
`/product/…` or `/collection/…` slug that does not resolve, or resolves to a
product that is not live, and the fallback meta in both cases. Send the shell
with that status; React still boots and renders its own not-found page. Match
what `/sitemap.xml` already does — it lists live products only — so the two
never disagree about what exists.

## 3 · Console noise on every page load

**Files:** `src/lib/account.ts:26`, `server/routes/account.ts`,
`src/router.tsx`, `src/lib/useStore.ts`

Three things a developer sees in the console before touching anything:

- **A red 401.** The customer session probe `GET /api/account` answers 401 for
  a signed-out shopper, `fetchCustomer` catches it and returns `null`, and the
  browser logs the failed request anyway. It is correct and it looks like a bug.
  Answer `200` with `null` — `{ customer: null }` — for "nobody signed in"
  from the probe alone; leave every other `/api/account/*` route on
  `requireCustomer`'s 401. Update `fetchCustomer` and the `useCustomer` test.
- **`No HydrateFallback element provided`** from react-router, on every load in
  development. The root route has `lazy` children and no `HydrateFallback`.
  Add one that renders the same skeleton `App.tsx`'s `ShellFallback` does.
- **`/api/store` and `/api/account` are each fetched twice** on first paint in
  the production build, so it is not StrictMode. Find the second subscriber —
  likely `useCartRecoverySync` or `Banner` mounting a query with different
  options — and share the key.

## 4 · A new product opens with three errors

**File:** `src/admin/ProductEditorPage.tsx:684`

`/admin/products/new` shows *A product needs a name*, *The web address must be
lowercase words separated by hyphens*, and *Price 1 is not an amount* in red
before the merchant has typed anything. `problems(draft)` is right that the
draft is invalid; showing that as errors on an untouched form reads as a
broken page.

Track whether the form has been touched — any field edited, or a save
attempted — and render the issue list only after that. The autosave indicator
already distinguishes *Saves automatically* from *Waiting for the details
below* (`useAutosave.ts`, `SaveIndicator.tsx`); the list should follow the same
rule. Per-field `error` props such as the tax code's can stay, since a field
only has an error once it has a value.

## 5 · The hero says something false

**File:** `src/pages/LandingPage.tsx:19`

*This is your storefront's hero. Edit it in the admin, or replace this
component entirely.* There is no admin field for it. Task 21 adds one; until it
lands, the sentence should say what is true: *Replace this text in
`src/pages/LandingPage.tsx`, or wait for the admin field.* If 21 lands first,
this group is done by it.

## Out of scope

- Server-side rendering. Group 2 sets a status code; it does not render a body.
- Per-page descriptions or Open Graph tags on the client. The server already
  writes those and nothing on the client overwrites them.

## Definition of done

Per `docs/tasks/README.md`, plus:

- A component test per storefront page that `document.title` is `name · store`
  after render.
- A server test that `/product/<unknown>` and `/product/<draft-slug>` answer
  404 with the shell body, and `/product/<live-slug>` still answers 200 with the
  product title in the head.
- A test that `GET /api/account` answers 200 with a null customer when nobody
  is signed in, and that `GET /api/account/orders` still answers 401.
- The dev console on the landing page shows no warnings and no failed
  requests. Say so in the PR, with the console output.
