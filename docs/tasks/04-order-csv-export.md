# 04 · Export orders as CSV

**Size** small · **Migration** none · **Blocked by** [00](00-order-items-query.md)

## Why

A merchant does their bookkeeping in a spreadsheet, and there is currently no way
to get an order out of Beluga except by reading it off the screen. This is
routinely a hard requirement in an evaluation.

**Do [00](00-order-items-query.md) first.** Exporting with the current
`loadItems` would load the entire `order_items` table into memory for each page
of orders.

## What to build

### Route

In `server/routes/admin.ts`, orders section:

```
GET /api/admin/orders.csv?status=<OrderStatus>&from=<epoch_ms>&to=<epoch_ms>
200: text/csv
```

Register it **before** `GET /orders/:id` (`server/routes/admin.ts:335`) or Express
will match `orders.csv` as an `:id`. This is the kind of thing that ships
silently broken; put a comment on the line saying why the order matters.

Headers:

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="orders-YYYY-MM-DD.csv"
```

### Shape

One row per **order line**, not per order, so quantities and product names are
usable in a pivot table. Order-level fields repeat across an order's rows.

```
order_reference,order_id,placed_at,status,email,
product_name,variant_label,options,quantity,unit_price_cents,line_total_cents,
order_subtotal_cents,order_shipping_cents,order_tax_cents,order_total_cents,currency,
shipping_name,shipping_line1,shipping_line2,shipping_city,shipping_state,shipping_postal_code,shipping_country,
carrier,tracking_number,oversold
```

If [01](01-refund-order.md) or [03](03-discount-codes.md) have landed, add
`order_refunded_cents` / `order_discount_cents` after `order_total_cents`.

**Amounts stay in integer cents.** Invariant 1. Name every money column
`*_cents` so nobody in a spreadsheet mistakes them for dollars, and say so in the
README. `placed_at` is ISO 8601 UTC.

### Escaping

Write a small local helper; do not add a CSV dependency for this.

- Wrap a field in double quotes if it contains a comma, a double quote, a newline
  or a carriage return; double any embedded quotes.
- **Neutralise formula injection.** A product named `=HYPERLINK(...)` becomes a
  live formula when the file is opened in Excel or Sheets. Prefix any field whose
  first character is one of `= + - @` TAB or CR with a single quote. Product
  names and options are merchant- and buyer-supplied, so this is a real path.
- Emit a UTF-8 BOM (`﻿`) first so Excel reads non-ASCII product names
  correctly.

### Streaming and paging

Do not build the whole file in memory. Page through `listOrders` in batches of
100 (its clamp — `db/orders-repository.ts:227`), writing each batch with
`res.write()`, then `res.end()`. Add a hard cap of 50,000 rows; if it is hit,
stop and log an operator-facing line. A merchant with more orders than that needs
a date range, which is what `from` / `to` are for.

`listOrders` has no date filtering today. Add optional `from` / `to` to its
options and to the `where` it builds, using `gte` / `lte` on
`schema.orders.createdAt`. **Mind the dialect:** SQLite stores unix seconds and
Postgres a timestamptz — `toEpochMs` at `db/orders-repository.ts:33` documents
the difference. Convert the query parameter per dialect rather than passing raw
milliseconds to both.

### Client

A "Download CSV" button on `src/admin/OrdersPage.tsx` that respects the status
filter currently in effect. This is a `GET` on a cookie-authenticated route, so a
plain `<a href>` works and no CSRF token is needed — `verifyCsrf`
(`server/middleware.ts:100`) should already be skipping safe methods; confirm it
does before assuming.

## Acceptance

- The CSV opens in Excel and Sheets with no mangled characters.
- A product named `=1+1` appears as text, not a formula.
- A product name containing a comma and a quote round-trips.
- `?status=paid` exports only paid orders; `?from=&to=` bounds by date on both
  dialects.
- An order with three lines produces three rows sharing one reference.
- The route is in `READS` in `server/security.test.ts` and 401s anonymously.

## Tests to add

- Unit-test the escaping helper directly: comma, quote, newline, leading `=`,
  leading `-`, empty string, non-ASCII.
- A supertest case asserting the `Content-Type`, the `Content-Disposition`
  filename, and the header row.
- A dialect test that `listOrders({ from, to })` bounds correctly on SQLite and
  Postgres.

## Out of scope

- CSV **import** of orders.
- Excel (.xlsx) output.
- Scheduled or emailed exports.
