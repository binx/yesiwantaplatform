---
task: "02"
title: Restore stock when an order is refunded
status: done
tier: 0
size: S
migration: one column
blocked_by: ["01"]
blocks: []
touches: db/orders-repository.ts:328 · server/routes/webhook.ts:103
completed: 2026-09-07
shipped_in: 65d6f67
summary: >-
  `decrementInventoryForOrder` runs on `checkout.session.completed`, but `handleRefund`
  only changes the status — nothing reverses it. Every refund silently burns inventory,
  and because the decrement is guarded against going negative, the error compounds quietly
  rather than crashing. Ship this with 01; they're the same afternoon.
---

# 02 · Restore stock when an order is refunded

## The problem

`decrementInventoryForOrder` (`db/orders-repository.ts:328`) runs when a payment
is confirmed. **Nothing ever reverses it.** `handleRefund`
(`server/routes/webhook.ts:103`) only changes the status, and there is no
cancellation path at all, so:

- every refund permanently burns the stock the order consumed;
- the error is silent, because the decrement is guarded against going negative
  and simply leaves the count where it is;
- a store that refunds regularly drifts toward showing sold-out on items it
  still has.

## What to build

### 1. Guard against double restocking

A refund can arrive as several webhooks, and a merchant may also cancel an order
by hand. Restocking must happen at most once per order. Add to the `orders`
table in **both** dialect files:

```ts
/** Set once stock has been returned, so a second refund event is a no-op. */
restockedAt: integer("restocked_at"),
```

Use the same column style as the existing nullable timestamp
`adminUsers.lastLoginAt` in `db/schema.sqlite.ts:42`, and its `timestamp` /
`timestamptz` equivalent in `db/schema.pg.ts`. Run `npm run db:generate`.

### 2. Repository

```ts
/**
 * Return an order's stock to the catalogue.
 *
 * Mirrors decrementInventoryForOrder: finite variants only, unguarded on the
 * way up because putting stock back can never go negative. Returns false if
 * this order was already restocked.
 */
export async function restockInventoryForOrder(orderId: string): Promise<boolean>
```

Implementation notes:

- Claim the order first with a **conditional update** —
  `set({ restockedAt: now }).where(and(eq(id, orderId), isNull(restockedAt)))` —
  and check the affected row count. Two concurrent webhooks must not both
  proceed. This is the same "guard in SQL rather than in a transaction" approach
  the decrement uses, and for the same reason: the transaction API differs
  between the two dialects.
- Skip items with a null `variantId` (the variant was deleted) and variants whose
  `inventoryType` is not `"finite"`.
- Increment with `sql\`${schema.variants.inventoryQuantity} + ${item.quantity}\``.

Drizzle's update result exposes a row count differently per driver. If reading it
cleanly is awkward, re-select the row and compare `restockedAt` — but the
conditional update must still be what claims it.

### 3. Wire it up

In `handleRefund` (`server/routes/webhook.ts:103`), call
`restockInventoryForOrder` **only on a full refund** — the same condition that
sets status to `refunded` after [01](01-refund-order.md). A partial refund does
not tell you which line came back.

Also call it from the fulfilment route (`server/routes/admin.ts:341`) when the
status changes **to** `cancelled` from a status that had consumed stock
(`paid`, `processing`, `shipped`). Compare against the order you already loaded
on line 342 — do not restock when the status is unchanged, or a merchant saving
a tracking-number typo would restock a second time. The `restockedAt` guard
makes that safe anyway; both belts.

### 4. Surface it

An order that was flagged `oversold` and is later refunded may restock stock it
never actually took. Note this in the admin: when `oversold` is true, the order
detail page should say stock was not fully deducted, so the merchant knows the
restock may over-count. One sentence near the existing oversold treatment in
`src/admin/OrderDetailPage.tsx` is enough.

## Acceptance

- Refunding a paid order in full returns each finite variant's quantity to what
  it was before the order.
- Replaying the `charge.refunded` event does not restock twice.
- A partial refund does not restock.
- Cancelling an order restocks; saving the same order again does not.
- Infinite-inventory variants are untouched.

## Tests to add

In `db/dialect.test.ts` (it already covers `decrementInventoryForOrder`):

- decrement then restock returns the variant to its starting quantity;
- a second `restockInventoryForOrder` for the same order returns `false` and
  changes nothing;
- an order with a deleted variant restocks the remaining lines and does not throw.

## Out of scope

- Per-line restocking, or asking the merchant which items came back.
- Reconciling an `oversold` order's true deducted quantity. Flag it in the UI;
  don't try to compute it.
