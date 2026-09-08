---
task: "00"
title: Fetch order items by order id
status: done
tier: 0
size: S
migration: none
blocked_by: []
blocks: ["04"]
touches: db/orders-repository.ts:168
completed: 2026-09-07
shipped_in: 
summary: >-
  `loadItems` selects the entire `order_items` table and filters it in JavaScript, with an
  `includes()` inside the loop. Every caller pays it — including the payment webhook,
  which reaches it through `getOrder`. It's invisible on a demo catalogue and quietly
  quadratic on a real one. **Fix this before the CSV export**, which would otherwise page
  through the whole table once per batch.
---

# 00 · Fetch order items by order id

## The problem

`loadItems` in `db/orders-repository.ts:168` selects **every row in
`order_items`** and then filters in JavaScript:

```ts
const rows = (await db.select().from(schema.orderItems)) as unknown as OrderItemRow[];

const map = new Map<string, OrderItemRow[]>();
for (const row of rows) {
  if (!orderIds.includes(row.orderId)) continue;
  ...
}
```

Two defects compound:

- The query is unbounded. A store with 50,000 order lines loads all of them to
  render one order detail page.
- `orderIds.includes()` inside the loop makes the filter O(rows × orders), so
  listing 25 orders scans the array 25 times per row.

Every caller is affected: `getOrder`, `findOrderByCheckoutSession`, `listOrders`,
and `decrementInventoryForOrder` (which calls `getOrder`, so it pays this cost on
the payment webhook's critical path).

## What to build

Rewrite `loadItems` to query only the orders asked for, and to group in one pass.

```ts
async function loadItems(orderIds: string[]): Promise<Map<string, OrderItemRow[]>> {
  const { drizzle: db, schema } = await getDatabase();
  if (orderIds.length === 0) return new Map();

  const rows = (await db
    .select()
    .from(schema.orderItems)
    .where(inArray(schema.orderItems.orderId, orderIds))) as unknown as OrderItemRow[];

  const map = new Map<string, OrderItemRow[]>();
  for (const row of rows) {
    const existing = map.get(row.orderId);
    if (existing) existing.push(row);
    else map.set(row.orderId, [row]);
  }
  return map;
}
```

`inArray` comes from `drizzle-orm` — add it to the import on line 2. It is
already used this way in `db/repository.ts:226`.

**Ordering.** `order_items` has no position column and `buildOrder` doesn't sort,
so line order is currently whatever the engine returns. Add
`.orderBy(asc(schema.orderItems.id))` so an order renders the same way twice.
This is a behaviour fix, not a schema change.

**Chunking.** SQLite's default parameter limit is 999. `listOrders` clamps to 100
orders per page (`db/orders-repository.ts:227`) so a single `inArray` is safe
today — but add a guard that chunks `orderIds` into batches of 500 and merges the
maps, so a future caller passing a larger list doesn't hit
`SQLITE_ERROR: too many SQL variables`.

## Acceptance

- `loadItems` issues no query when `orderIds` is empty (already true; keep it).
- An order's items come back in a stable order across repeated calls.
- 600 order ids in one call succeeds on SQLite.
- `db/dialect.test.ts` passes against both engines.

## Tests to add

In `db/dialect.test.ts`, alongside the existing order assertions:

- Seed two orders with items each; assert `getOrder(a)` returns only a's items.
- Seed one order with three items; assert two successive `getOrder` calls return
  items in the same order.

## Out of scope

- Adding a `position` column to `order_items`. Sorting by id is enough for
  stability; a real display order is only worth it if someone asks.
- Changing `buildOrder`, `OrderRow`, or the `Order` schema.
