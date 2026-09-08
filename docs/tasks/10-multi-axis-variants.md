# 10 · Multi-axis variants

**Size** large · **Migration** two tables + backfill · **Blocks** [15](15-catalogue-csv.md)

## The problem

A product has exactly **one** variant axis. `products.variantName` is a single
label — "size" — and `variants.label` is a single value — "Large"
(`db/schema.sqlite.ts:67`, `:80`). A shirt in three sizes and two colours has to
be entered as six variants labelled "Small / Blue", "Small / Red", … with no way
to render two selectors, no way to grey out an unavailable combination, and no
way to change "Blue" everywhere at once.

Shopify allows three options with a generated matrix. This is the most-cited
catalogue gap.

**Do this before [15](15-catalogue-csv.md).** An importer written against the
current shape would have to be rewritten immediately.

## What does not change

- **A variant is still exactly one Stripe Price.** `syncProductToStripe`
  (`server/catalog-sync.ts:57`) and the line-item construction at
  `server/routes/checkout.ts:83` are untouched by this. Say so in the PR — it is
  the reassuring fact that keeps this from looking like a payments change.
- Inventory, weight and image association stay on the variant.
- `optionGroups` (`db/schema.sqlite.ts:117`) is a **different feature** —
  non-priced choices like gift wrap, deliberately separated from priced SKUs
  because v1 conflated them. Do not merge the two. Read that comment before
  starting.

## What to build

### 1. Schema — both dialects

```ts
/** A named axis: "Size". Up to 3 per product. */
export const productOptions = sqliteTable("product_options", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
}, (t) => [index("product_options_product_idx").on(t.productId)]);

/** A value on that axis: "Large". */
export const productOptionValues = sqliteTable("product_option_values", {
  id: text("id").primaryKey(),
  optionId: text("option_id").notNull().references(() => productOptions.id, { onDelete: "cascade" }),
  value: text("value").notNull(),
  position: integer("position").notNull().default(0),
}, (t) => [index("product_option_values_option_idx").on(t.optionId)]);

/** Which value on each axis this variant is. */
export const variantOptionValues = sqliteTable("variant_option_values", {
  variantId: text("variant_id").notNull().references(() => variants.id, { onDelete: "cascade" }),
  optionValueId: text("option_value_id").notNull().references(() => productOptionValues.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.variantId, t.optionValueId] })]);
```

Keep `variants.label` as a **denormalised display string** ("Large / Blue"),
regenerated on save. Order snapshots (`orderItems.variantLabel`) already copy it
at purchase time and must keep working for historic orders whose variants are
gone. Do not drop it.

Keep `products.variantName` for one release, deprecated, so a rollback is
possible.

### 2. Backfill

A data step in `db/migrate.ts`, idempotent, running identically on both dialects:

For each product with variants and no `product_options` row:
- if `variantName` is set, create one option with that name; otherwise name it
  "Option";
- create one value per distinct `variants.label`, preserving `position`;
- link each variant to its value;
- leave `label` untouched.

A product with a single unlabelled variant (`label === ""`) gets **no** options —
that is the "no variants" case and must stay that way, or every simple product
grows a meaningless selector.

Assert idempotency in a test. This migration will run on live stores.

### 3. Shared schema

`shared/api.ts` — extend `productInputSchema` (line 31):

```ts
options: z.array(z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(50),
  values: z.array(z.string().min(1).max(80)).min(1).max(50),
})).max(3).default([]),
```

and on `variantInputSchema` (line 22), `optionValues: z.array(z.string()).max(3).default([])`
— the selected value **per axis, in axis order**.

Validate in the route, not just the schema:
- every variant names exactly one value per option;
- no two variants share the same combination (409, naming the duplicate);
- total variants ≤ 50, matching the existing cap on line 37.

### 4. Product editor

The hardest part. `src/admin/ProductEditorPage.tsx` is one autosaving form
(`src/admin/useAutosave.ts`) and must stay that way — the single-form design is a
deliberate correction of v1's four-step wizard, documented in the README.

- An options editor: add/rename/remove an axis, edit its values.
- A generated variant matrix: adding a value creates the new combinations, with
  price, inventory and weight editable per row.
- **Removing a value must warn** before destroying variants that have inventory
  or have been sold. Removing an axis with sales history is destructive; require
  confirmation naming the count.
- Bulk-set price across the matrix — with six or more rows, per-row entry is the
  main complaint about this UI in every store admin.

### 5. Storefront

`src/pages/ProductPage.tsx` renders one selector today. Render one per axis, and:

- disable value combinations no variant covers, rather than allowing a dead
  selection;
- keep the existing behaviour of resolving the chosen variant before adding to
  the cart — **the cart stores identifiers only** (README, Database section), so
  nothing here changes about what the cart holds;
- preserve keyboard operability and labelling from the Phase 4 work.

## Acceptance

- A product with Size × Colour renders two selectors and resolves the right
  variant id.
- The backfill turns an existing single-axis product into one option, once, and
  running it twice changes nothing.
- A simple product with one unlabelled variant shows no selector.
- Duplicate combinations are rejected with a message naming the duplicate.
- An existing order placed before the migration still renders its variant label.
- Publishing to Stripe creates the same Prices it did before.

## Tests to add

- Backfill idempotency, both dialects, in `db/dialect.test.ts`.
- Duplicate-combination rejection.
- Label regeneration matches axis order.
- A `ProductPage` component test selecting across two axes.
- An `e2e/storefront.spec.ts` case buying a two-axis product.

## Out of scope

- More than three axes.
- Per-variant images. Related and frequently wanted, but it touches the image
  manager and the carousel; keep it separate.
- Per-variant SKU codes.
