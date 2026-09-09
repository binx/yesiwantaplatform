---
task: "31"
title: Checkout, quotes and publish past 200 live products
status: todo
tier: 0
size: S
migration: none
blocked_by: []
blocks: []
touches: server/routes/checkout.ts:52 · server/routes/shipping.ts:63 · server/routes/admin.ts:946 · db/repository.ts:430
completed:
shipped_in:
summary: >-
  Checkout, the shipping quote and Publish each load the catalogue with
  `listProducts({ limit: 200 })` and look the cart's products up in that page. Product 201
  can be browsed and added to a cart but never bought — checkout answers "no longer
  available" — and cannot be published from the editor. Replace the three page reads with
  a lookup by id, which is what they were doing anyway.
---

# 31 · Checkout, quotes and publish past 200 live products

`listProducts` clamps `limit` to 200 (`db/repository.ts:336`), for the good
reason that the public listing pages through. Three callers use it as if it
returned the whole catalogue:

- `server/routes/checkout.ts:52` — builds `byId` from the first 200 live
  products and throws *An item in your cart is no longer available* for any
  line it cannot find.
- `server/routes/shipping.ts:63` — `quoteShipping` does the same, so the cart
  page shows no rates for such a line.
- `server/routes/admin.ts:946` — the publish route finds the product in the
  first 200 of *all* products, drafts included, and 404s otherwise.

The storefront's browse pages are paginated and unaffected; the store snapshot
is capped at `STORE_SNAPSHOT_LIMIT` deliberately and documents it. This is
about the three paths that resolve *specific* products and reached for a page
to do it.

## What to build

### `findProductsByIds`

In `db/repository.ts`, next to `findProductsBySlugs` (`:430`), add

```ts
export async function findProductsByIds(ids: string[], liveOnly: boolean): Promise<Product[]>
```

with the same hydration `findProductsBySlugs` uses, so the returned shape is
identical. An `inArray` on `products.id`, chunked at 500 if the driver's
parameter limit is a concern — carts are capped at 100 lines by
`checkoutRequestSchema`, so in practice one query.

### The three callers

- Checkout and `quoteShipping` collect the distinct `productId`s from the
  lines and call `findProductsByIds(ids, true)`. Everything after `byId` is
  unchanged, including every 409 message.
- Publish calls `findProductBySlug`'s by-id twin — add `findProductById(id,
  liveOnly = false)` if none exists, or reuse `findProductsByIds([id],
  false)[0]`.

Invariant 2 in `docs/tasks/README.md` is what makes this safe to change
freely: nothing about price comes from the request, and the lookup by id is
exactly as authoritative as the page scan was.

## Definition of done

Per `docs/tasks/README.md`, plus:

- `db/dialect.test.ts` covers `findProductsByIds` on both dialects, including
  an unknown id (absent, not an error) and `liveOnly` hiding a draft.
- `server/checkout.test.ts` seeds 201 live products and checks out the last
  one. Seeding is a loop over `createProduct`; keep the fixtures minimal.
- `server/shipping.test.ts` gets the same for a quote.
- No new route.

## Conflicts

Task 30 edits the same publish route to map Stripe errors. Land one before
starting the other.
