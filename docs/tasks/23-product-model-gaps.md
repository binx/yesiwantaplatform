---
task: "23"
title: SKUs, compare-at prices and per-variant images
status: done
tier: 2
size: L
migration: two columns on variants, one on product_images, one on order_items
blocked_by: []
blocks: []
touches: shared/schema.ts · db/schema.sqlite.ts · db/schema.pg.ts · src/admin/ProductEditorPage.tsx · shared/catalogue-csv.ts · server/routes/checkout.ts
completed: 2026-09-09
shipped_in:
summary: >-
  Three fields every platform a merchant is migrating from has, and Beluga's variant does
  not: a SKU, a compare-at price for showing a markdown, and an image per variant so
  picking "Blue" shows the blue one. Each is a column and a piece of the editor; together
  they touch the CSV contract, the price matrix, the product page and the order line, which
  is why this is one planned change rather than three squeezed-in ones.
---

# 23 · SKUs, compare-at prices and per-variant images

Found by building a product in the editor and reaching for fields that were not
there. None of these is exotic; all three are on the Shopify export the
catalogue CSV (task 15) was shaped to match, and a merchant importing from
there loses them on the way in.

## The problem

`variantSchema` (`shared/schema.ts:47`) is `label`, `priceCents`, `inventory`,
`weightGrams`, `stripePriceId`, `optionValues`. So:

- **No SKU.** The order line records the product and variant ids, which mean
  nothing to a warehouse or an accounting import. The order CSV (task 04) has
  no column a fulfilment provider can match on, and the outbound
  `order.paid` webhook (task 14) carries ids only. Every receiver Beluga is
  meant to plug into keys on SKU.
- **No compare-at price.** A sale is a price change: the old price is gone
  from the storefront and from the order. There is no way to show *was $42,
  now $34*, which is the single most common merchandising gesture a shop
  makes, and the accent colour's stated purpose — *sale badges* — has nothing
  to badge.
- **No per-variant image.** `productImages` hang off the product. Picking
  *Blue* in the variant selector shows the same carousel as *Red*. The demo
  store's tote has three images and two sizes, which hides it; a colour axis
  does not.

## What to build

### 1 · SKU

`sku` (nullable text, unique per store when set) on `variants`, in both
dialects, with a unique index that ignores nulls — a partial index in
Postgres, `WHERE sku IS NOT NULL` in SQLite. The editor's price matrix gets a
column; single-variant products get a field under Price. Validate as trimmed,
1–64 characters, no whitespace, and report a duplicate by naming the other
product.

Carry it everywhere an order line is written or read: `orderItems` gains a
`sku` snapshot column (the variant may be edited later; the order must say what
was sold), the order CSV gains `sku`, the admin order page shows it, the
`items` email partial shows it, and the webhook envelope's line items include
it. The catalogue CSV gains `variant_sku`, matched on import the same way
option values are: a row whose SKU matches an existing variant is that variant.

Stripe's Price has no SKU field; put it in `metadata.sku` on publish so a
merchant reading the Stripe dashboard can see which is which.

### 2 · Compare-at price

`compare_at_price_cents` (nullable integer) on `variants`. Integer cents like
every other money column; refused when not strictly greater than `priceCents`,
since a compare-at price that is lower is not a markdown, it is a mistake.

The storefront shows it struck through next to the price on the card and the
product page, with a **Sale** badge in the accent colour — the badge the theme
was designed for. `ProductList` and `ProductCard` render a range today
(`$34.00 – $42.00`); when any variant in the range has a compare-at, show the
badge and leave the range as the current prices. The product page shows the
struck price for the selected variant only.

It is display only: checkout charges `priceCents`, and nothing about
invariant 2 changes. It is **not** sent to Stripe; Stripe has no such concept
on a Price, and the discount code machinery (task 03) is unrelated.

The catalogue CSV gains `variant_compare_at_price_cents`.

### 3 · Per-variant images

`variant_id` (nullable, references `variants.id`, on delete set null) on
`product_images`. An image with a null `variantId` belongs to the product as
today; one with a variant is shown first when that variant is selected, and
still appears in the full carousel. This is the least invasive model: no
second image table, no image duplicated across variants, and every existing
row is unchanged.

In the editor, each thumbnail in `ImageManager` gets a select — *All variants*
or one variant by label. On a product whose options change, images pointing at
a variant that was removed fall back to the product via the foreign key.

The storefront's `ProductDetails` reorders the carousel when the selection
changes, and the collection card uses the product's first image as before.

The catalogue CSV's `image_paths` is export-only (task 15) and stays that way;
add a `variant_image_paths` export column beside it for parity, also ignored
on import.

## Migration

Four columns, both dialects, no backfill: every new column is nullable and
every reader has a fallback. The `orderItems.sku` snapshot is null for orders
placed before this lands, and the CSV writes an empty cell.

## Out of scope

- Barcodes, HS codes, cost price. Real, and each is one more column on the
  same pattern; add them when a fulfilment or accounting integration needs
  them rather than speculatively.
- Tags, product types, vendors, related products. Collections are Beluga's
  grouping model; a second one needs its own argument.
- Scheduled sales. A compare-at price is set and cleared by hand.
- Inventory by location.

## Definition of done

Per `docs/tasks/README.md`, plus:

- Both dialects, both migration folders, and `db/dialect.test.ts` green on
  both — the partial unique index is the part most likely to differ.
- A test that a duplicate SKU is refused and names the other product.
- A test that `compareAtPriceCents <= priceCents` is refused.
- A checkout test that a variant with a compare-at price is charged
  `priceCents`.
- A CSV round-trip test: export with all three fields, import, nothing
  changes.
- `server/security.test.ts` needs no new entry unless a route is added; say so
  in the PR if none was.
- README **Products** and **Importing and exporting the catalogue** sections
  updated with the new columns.
