---
task: "06"
title: Storefront search and sort
status: done
tier: 1
size: S
migration: none
blocked_by: []
blocks: []
touches: src/pages/ShopPage.tsx · shared/catalog.ts
completed: 2026-09-07
shipped_in: 2234008
summary: >-
  **The backend already exists — don't build one.** `listProducts` implements
  case-insensitive matching across name and description, `productQuerySchema` accepts
  `search`, and `GET /api/products` passes it through. Nothing on the storefront calls any
  of it, because the storefront loads the whole catalogue once from `/api/store`. So this
  is client-side filtering over data already in memory: no request, no server change,
  works against the demo fixture.
---

# 06 · Storefront search and sort

## What already exists

More than you'd expect. **Do not build a search backend — there is one.**

- `listProducts` implements case-insensitive `LIKE` matching across name and
  description at `db/repository.ts:203-211`.
- `productQuerySchema` already accepts `search` (`shared/api.ts:167`).
- `GET /api/products?search=` already passes it through
  (`server/routes/public.ts:41-51`).

What's missing is entirely on the storefront: `src/pages/ShopPage.tsx` renders a
collection grid with no query input, no sort, and no filter.

## The one architectural fact that decides this task

The storefront does **not** page through `/api/products`. It loads the whole
catalogue once from `GET /api/store` via `loadStore`
(`src/lib/store-source.ts:19`) and reads it through `useStore()`. See
`getStoreSnapshot` at `db/repository.ts:378`, which returns every live product up
to `STORE_SNAPSHOT_LIMIT`.

So **filter client-side against `useStore()`**. Do not add a fetch. It is
instant, works offline against the demo fixture (`VITE_BELUGA_API=false`), and
needs no server change at all.

Add a comment where the filtering happens noting that when a catalogue outgrows
`STORE_SNAPSHOT_LIMIT`, the swap is to `GET /api/products?search=` behind
`src/lib/store-source.ts` — the same seam that absorbed the Phase 1 fixture →
Phase 2 database change.

## What to build

### 1. A matcher in `shared/catalog.ts`

That file already holds `getLiveProducts` and `getVisibleCollections`. Add:

```ts
export function searchProducts(products: Product[], query: string): Product[]
export function sortProducts(products: Product[], by: SortOrder): Product[]
export type SortOrder = "featured" | "price-asc" | "price-desc" | "name";
```

- Match on name, description and bullet points, case- and diacritic-insensitive
  (`.normalize("NFD").replace(/\p{Diacritic}/gu, "")`), on every whitespace-
  separated term — all terms must match somewhere (AND), so "blue tote" doesn't
  return every blue thing.
- An empty or whitespace-only query returns the input unchanged.
- `"featured"` is the existing order and must be the default: `listProducts`
  sorts by `position` then `name` (`db/repository.ts:252`) and collections carry
  a curated order that a re-sort would destroy (`db/repository.ts:233`).
- Price sorts use the **lowest** live variant price per product.

Putting this in `shared/` rather than the component keeps it unit-testable
without rendering and matches where `getLiveProducts` lives.

### 2. UI on `src/pages/ShopPage.tsx`

The page currently branches: with no collections it lists all products, otherwise
it shows a collection grid (`src/pages/ShopPage.tsx:15-26`). Add the search input
to **both** branches, above the results. When a query is active, show matching
products directly rather than collections — a shopper searching wants products.

- A labelled `<input type="search">`. Not a bare input with a placeholder: the
  label is required for the accessibility work Phase 4 exists to protect.
- Debounce state updates by ~150ms.
- Announce the result count in an `aria-live="polite"` region: "12 products".
- An empty state that names the query and offers a clear action, not a shrug.
- Sort as a labelled `<select>`.

### 3. Keep it in the URL

Read and write `?q=` and `?sort=` with `useSearchParams` from `react-router-dom`.
A search result must survive a reload and be shareable, and the back button
should undo a search. Use `replace: true` while typing so each keystroke doesn't
add a history entry.

Also apply the same search box to `src/pages/CollectionPage.tsx`, scoped to that
collection's products.

## Acceptance

- Typing filters without a network request (check the Network tab is quiet).
- `?q=tote` deep-links to results.
- Back after a search returns to the unfiltered page.
- Diacritics: "cafe" matches "Café".
- Multi-term: "blue tote" matches only products with both.
- Clearing the query restores the original curated order.
- Works with `VITE_BELUGA_API=false` against the demo fixture.
- Keyboard-only: the input is reachable, the count is announced, focus is visible.

## Tests to add

- Unit tests for `searchProducts` and `sortProducts` in
  `shared/catalog.test.ts` (the file exists): empty query, whitespace, multi-term,
  diacritics, no matches, sort stability for equal prices.
- A component test for `ShopPage` using the existing helpers in
  `src/test-utils.tsx`: type a query, assert the rendered list and the live-region
  count.

## Out of scope

- Server-side search or pagination. Explicitly deferred — see the note above.
- Faceted filters (price range, in-stock, collection checkboxes).
- Fuzzy matching, typo tolerance, or a search index.
- Search analytics.
