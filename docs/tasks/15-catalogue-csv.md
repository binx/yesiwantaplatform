# 15 · Catalogue CSV import and export

**Size** medium · **Migration** none · **Blocked by** [10](10-multi-axis-variants.md)

## Why it's blocked

An importer written against today's single-axis variant shape
(`products.variantName` + `variants.label`) would need rewriting the moment
[10](10-multi-axis-variants.md) lands, and any file a merchant produced with it
would need re-importing. Wait.

## Why it matters

Migrating a hundred products from Shopify currently means a hundred passes
through the product editor. That is where an evaluation stops.

## What to build

### Export

`GET /api/admin/products.csv`. One row per **variant**, product fields repeated —
the same shape Shopify exports, which is the point: a merchant should be able to
diff the two. Reuse the escaping helper from [04](04-order-csv-export.md),
including the formula-injection prefix; do not write a second one.

Columns: `slug`, `name`, `description`, `bullet_points` (pipe-separated),
`option1_name`, `option1_value` … `option3_*`, `variant_price_cents`,
`variant_inventory_type`, `variant_inventory_quantity`, `variant_weight_grams`,
`is_live`, `image_paths`.

**Prices in integer cents**, named `*_cents`, per invariant 1. A file that says
`19.99` invites a round-trip through a float.

### Import

Two-phase, and do not compromise on this: **validate everything, show a preview,
then commit.** A partial import that half-updated a live catalogue is worse than
no import.

```
POST /api/admin/products/import/validate  -> { rows, creates, updates, errors[] }
POST /api/admin/products/import/commit    -> { created, updated }
```

- Match existing products by `slug`. Create when absent, update when present.
- Report every error with its **row number and column**, all of them at once —
  not the first failure. A merchant fixing a 500-row file one error per attempt
  will give up.
- Reject the whole file if any row fails, unless the merchant explicitly chooses
  "skip invalid rows", which the preview must offer and default to off.
- Group variant rows by slug and build the option matrix per
  [10](10-multi-axis-variants.md)'s rules, including its duplicate-combination
  check.
- **Never publish to Stripe as part of an import.** Invariant 7. Imported
  products land as drafts unless `is_live` says otherwise, and even then
  publishing stays the explicit, per-product action at
  `server/routes/admin.ts:308`. Say so in the preview UI.
- Cap the file size and the row count, and stream the parse rather than reading
  the whole file into memory.
- Reuse `productInputSchema` for per-row validation so the import cannot create
  something the editor would reject.

### UI

An import screen on `src/admin/ProductsPage.tsx`: drop a file, see a preview
table of what will be created and updated with errors inline, confirm.

## Acceptance

- Export then import with no edits is a no-op — nothing created, nothing changed.
  This is the test that proves the round-trip.
- A file with three bad rows reports all three, with row and column.
- An import never writes to Stripe.
- A 500-row file imports without exhausting memory.
- Multi-axis options survive the round-trip.

## Out of scope

- Importing images by URL. Paths reference already-uploaded assets.
- Importing orders or customers.
- A Shopify-specific column mapping. Document the format; let merchants map.
