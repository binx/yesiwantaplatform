---
task: "17"
title: Storefront copy and the gaps a UI pass found
status: in-progress
tier: 0
size: M
migration: none
blocked_by: []
blocks: []
touches: src/pages/ShopPage.tsx · src/App.tsx · src/admin/CollectionsPage.tsx · src/pages/CartPage.tsx
completed: 
shipped_in: 
summary: >-
  A pass over the running UI turned up copy that promises something the page does not do,
  links with no visual affordance at all, and two structural holes: the storefront has no
  footer of any kind, and a collection's `cover` can be seeded but never set from the
  admin. None of it needs a schema change. Seven independent groups — land them in any
  order, or split them across people.
---

# 17 · Storefront copy and the gaps a UI pass found

Found by walking the running app rather than reading it, so every item below was
observed in a browser against the seeded demo store. The visual and contrast
bugs from the same pass are already fixed (commit `6bbe90b`); what is left is
wording, affordance, and two things that are simply absent.

**The seven groups are independent.** Nothing here blocks anything else here, so
take them one at a time, or split them. Land each as its own commit.

## Why it matters

Three of these are the kind of thing an evaluator hits in the first ten minutes:
they press "Shop everything" and get a page with no products on it, they cannot
find a returns policy because there is no footer to put one in, and they make a
collection and discover it will never have a picture. None of that reads as
polish missing — it reads as the software not working.

---

## 1 · "Shop everything" leads to a page with no products

**Files:** `src/pages/ShopPage.tsx`, `src/pages/LandingPage.tsx`,
`src/components/product/ProductBrowser.tsx`

The hero button says **Shop everything** and "View all →" sits over the featured
row. Both go to `/shop`, which — whenever the store has collections — renders
two collection tiles, a search box, and no products at all.

Worse, there is then *no route to the whole catalogue*. `ShopPage` only shows a
flat list when `collections.length === 0` or when `searching` is true, and
`searching` requires a non-empty `?q=`. A shopper who wants to see everything
this store sells cannot, at any URL, unless they guess a search term. The
"Show everything" button on the empty-search state has the same problem: it
clears `q` and lands back on the two tiles.

Decide which of these the shop is, and make the copy and the routing agree:

- **If collections are the intended entry point**, the hero button is wrong.
  Say **Browse the shop** or **Shop by collection**, and add an explicit
  "All products" tile or link alongside the collections that sets a flag
  (`?all=1`, or a `/shop/all` route) which `ShopPage` treats like `searching`.
  Rename the empty-state button to **Clear search**, because that is what it does.
- **If the catalogue is the intended entry point**, drop the `controlsOnly`
  branch: show the collection tiles *above* a full product grid on the same page.
  One scroll, no dead end, and the existing copy becomes true.

Either is defensible. Leaving a button labelled "everything" pointing at two
tiles is not.

## 2 · Search result copy contradicts itself

**File:** `src/components/product/ProductBrowser.tsx`

Two problems in the same region:

- The heading reads **All products** while the list underneath is filtered.
  Searching `mug` gives "All products" over "1 product matching “mug”". Take the
  heading from the query: `Results for “mug”` when one is present, `All products`
  when it is not.
- The no-results state says the same thing twice, stacked: the `aria-live` count
  renders *0 products matching “zzzz”* and the empty block immediately below
  renders *Nothing matches “zzzz”.* Keep one. The `aria-live` line is the one
  that has to stay — it is what announces the result of typing to a screen
  reader — so drop the duplicate sentence from the empty block and leave it just
  the button.

## 3 · Cart and checkout wording

**Files:** `src/pages/CartPage.tsx`, `server/routes/checkout.ts`

- **The checkout error speaks to the wrong person.** A blocked checkout renders
  *"Canvas Tote" is not published to Stripe yet, so it cannot be sold.* That is a
  message for the merchant, shown to the shopper, and it names a payment
  processor the shopper has no relationship with. Split it: the shopper gets
  something like *Canvas Tote is unavailable right now.*, and the merchant-facing
  detail goes where merchants look — the admin already knows a product is
  unpublished, so surface it on the product row and the dashboard rather than in
  the buyer's cart. Keep the server's own error text as-is for the logs.
- **The cart clamps quantity in silence.** Typing `3` for a variant with 2 in
  stock snaps the field to `2` with no explanation. The product page handles this
  well — `ProductDetails` renders *Only 2 left* whenever stock is under five — and
  the cart should say the same thing when it clamps, next to the field it just
  changed. `normalizeQuantity` already returns the clamped value; the caller just
  has to notice it differs from what was typed.
- **`gift wrap: No`** is rendered under every line whether or not the shopper
  chose anything. Hide option groups still sitting on their default, or the meta
  line fills with noise as soon as a product has two or three of them.

## 4 · Links that do not look like links

**Files:** `src/pages/account/Account.module.css`, `src/pages/CartPage.module.css`,
`src/components/layout/Banner.tsx`

Inline links inside muted paragraphs inherit the paragraph's colour exactly
(`rgb(113,113,122)`), carry `text-decoration: none`, and are not bolder. There is
**no** visual cue that they are interactive — not a weak one, none:

- `/account/login` — "New here? **Create an account**". The link is half a
  sentence and looks identical to the other half.
- `/cart` — "**Sign in** for faster checkout and order tracking."
- `/account/forgot-password` — the whole line is the link, so it is clickable by
  accident rather than by design.

This is WCAG 1.4.1 territory, and it is one rule: give inline links inside
`.note` / `.footer` blocks an underline (or `--beluga-ink` plus underline on
hover). Do it in the shared CSS Modules rather than per page — the same pattern
appears in at least four files, and a fix applied one at a time will drift.

While in `Banner.tsx`: the mobile drawer shows **CART, 2 ITEMS** as a visible
menu item. That string is `cartLabel`, written for `aria-label` on the icon and
correct there. The drawer needs its own visible label — `Cart (2)` — with
`cartLabel` kept for the icon.

## 5 · The storefront has no footer at all

**Files:** `src/App.tsx`, new `src/components/layout/Footer.tsx` + module CSS

`ThemedShell` renders `<Banner />` and `<main>`, and nothing else. There is no
`<footer>` anywhere in `src/` — the only matches for "footer" are local class
names inside forms.

The consequence is bigger than a missing copyright line. `docs/tasks/08` shipped
merchant-authored Pages described as *"returns, shipping, contact, terms"*, and
`Banner.tsx` only lists pages with `inNav` set. **Any page not in the top nav is
unreachable** — no link to it exists on any page of the site. A shop cannot
publish a returns policy and have a customer find it.

Build a `<Footer />` and render it in `ThemedShell` after `<main>`:

- Every published page, `inNav` or not. This is the part that closes the hole.
- The store name and the current year.
- The collections, matching the header.
- Keep it token-driven (`--beluga-line`, `--beluga-muted`) so it follows a
  themed shop, and keep it a real `<footer>` element so it lands as a
  `contentinfo` landmark.

Nothing here needs new data: `store.pages` and `getVisibleCollections(store)` are
already on the client.

## 6 · A collection's cover image cannot be set

**Files:** `src/admin/CollectionsPage.tsx`, `shared/api.ts`,
`db/admin-repository.ts:450`, `server/routes/admin.ts`

`cover` is on the collection schema (`shared/schema.ts:165`), the seed fills it,
and `ShopPage` renders it at 16:9 on every collection tile. But nothing in
`src/admin` touches it, and the update payload does not carry it — grep for
`cover` under `src/admin/` and the only hits are an unrelated `object-fit`.

So a merchant who creates a collection gets a tile that renders
`ProductImage`'s *No image available* placeholder, permanently, with no way to
change it. Wire the existing `ImageManager` into each collection card, add
`cover` to the collection input schema in `shared/api.ts`, and pass it through
the repository update that already handles `slug`, `name` and `productIds`.

This is the one group here that touches the server. Per the README, the input
schema belongs in `shared/api.ts` rather than inline in the route, and no new
endpoint is needed — the existing admin collection update is enough, so
`server/security.test.ts` needs no new entry. Confirm that rather than assuming it.

## 7 · Admin copy and small fixes

**Files:** `src/admin/DashboardPage.tsx:75`, `src/admin/ProductEditorPage.tsx:425`,
`src/admin/WebhooksPage.tsx:240`, `src/admin/ShippingPage.tsx`,
`src/admin/ProductEditorPage.tsx`, `src/router.tsx`

- **`DashboardPage.tsx:75`** renders *Across the most recent 0 paid orders* on a
  store with no orders. Special-case the zero: say nothing, or *No paid orders
  yet.*
- **`ProductEditorPage.tsx:425`** sets `document.title` from
  `draft.name || "New product"`. On a URL with no such product the draft is
  empty, so a page reading *No product at this address.* is titled **New product ·
  Beluga**. Set the title from the load state, not the draft.
- **`WebhooksPage.tsx:240`** — `in the same` sits at the end of a JSX line and
  `<code> t=…,v1=… </code>` starts the next, so JSX drops the newline and the
  word butts straight against the chip, while the padding spaces *inside* the
  `<code>` produce a double gap after it. Move the spaces out of the element and
  add an explicit `{" "}`.
- **An unknown `/admin/*` URL renders the storefront 404.** The `/admin` route in
  `src/router.tsx` has no splat child, so a typo falls through to the root
  `{ path: "*" }` — losing the sidebar entirely and offering only "Back to the
  shop", which does not go back to the admin. Add a splat child under `/admin`
  that renders a not-found inside `AdminRoot`'s chrome.
- **The Options editor does not say which field is which.** The axis name input
  and its value inputs are visually identical, stacked in one box with identical
  delete buttons and no labels — so nothing tells a merchant the first row is
  "size" and the rest are "Small", "Large". The *Choices that don't change the
  price* card directly below it labels its fields properly; match that.
- **`ShippingPage` has two identical "Save shipping" buttons**, top-right and
  bottom-left, while `SettingsPage` has one. Keep the top-right one, for
  consistency with Settings.
- **Two antd deprecation warnings** are on the console on every run:
  `Image`'s `mask` prop (use `cover`) and `InputNumber`'s `addonAfter`
  (use `Space.Compact`). Both are one-line changes and both will become errors
  on the next major.

---

## Out of scope

- **Anything that needs a migration.** Every item above works with today's schema.
- **The featured grid's empty fourth column.** `ProductList` uses
  `auto-fill` where the collections grid uses `auto-fit`, so three featured
  products leave a gap on a wide screen. That is a deliberate trade — `auto-fill`
  keeps card size stable across pages with different counts — and changing it is
  a design call, not a bug fix. Raise it with whoever owns the visual design.
- **The admin's `Tag` contrast.** "Live" is antd's stock green at 3.37:1, under
  AA. It is real, but it is antd's palette in an internal tool, and fixing it
  properly means overriding `Tag` presets globally. Worth its own brief.
- **The 404 illustration, the contrast failures, the clipped Staff table, the
  mobile cart, the unnamed variant selects.** All fixed in `6bbe90b`.

## Definition of done

Per `docs/tasks/README.md`, plus:

- `npm run typecheck && npm run lint && npm test` pass.
- The footer's page list is covered by a component test: a published page with
  `inNav: false` must appear in the footer. That is the whole point of group 5,
  and it is the item most likely to regress silently.
- Group 6 adds `cover` to the shared input schema, not inline in the route, and
  round-trips: set a cover in the admin, reload, confirm it renders on `/shop`.
- The README's **Pages** section is updated to say pages not in the nav are
  reachable from the footer.
- Frontmatter here set to `done` with `completed` and `shipped_in`, then
  `npm run roadmap` run and its output committed.
