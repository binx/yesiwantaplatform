---
task: "01"
title: Refund an order from the admin
status: done
tier: 0
size: S
migration: one column
blocked_by: []
blocks: ["02"]
touches: server/routes/admin.ts · src/admin/OrderDetailPage.tsx
completed: 2026-09-07
shipped_in: f6db9de
summary: >-
  Most of this already exists. The `charge.refunded` handler is live and flips the order
  to `refunded`, and the Refunded email template is written. What's missing is the half
  that moves money: an admin route calling `stripe.refunds.create` and a button on the
  order page. Today a merchant marks an order refunded in Beluga and the buyer gets an
  email about a refund that never happened.
---

# 01 · Refund an order from the admin

## The problem

The admin can set an order's status to `refunded` and email the customer about
it, and **no money moves**. There is no call to Stripe's refund API anywhere in
the codebase. A merchant marks the order refunded in Beluga, the buyer gets the
`Refunded` email from `emails/Refunded/`, and the charge is untouched.

The receiving half already works: `handleRefund` at `server/routes/webhook.ts:103`
listens for `charge.refunded`, reads `beluga_order_id` from the charge metadata,
and flips the order to `refunded`. What's missing is the half that initiates one.

## What to build

### 1. Schema — both dialects

Add to the `orders` table in **both** `db/schema.sqlite.ts:202` and
`db/schema.pg.ts`:

```ts
/** Cumulative amount refunded. Less than totalCents means a partial refund. */
refundedCents: integer("refunded_cents").notNull().default(0),
```

Then `npm run db:generate` and commit both migrations.

### 2. Shared schema

In `shared/orders.ts`, add to `orderSchema` (after `oversold`):

```ts
refundedCents: centsSchema,
```

and a new input schema:

```ts
export const refundInputSchema = z.object({
  /** Omit to refund the full remaining amount. */
  amountCents: centsSchema.nullable().default(null),
  reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).default("requested_by_customer"),
  notify: z.boolean().default(false),
});

export type RefundInput = z.infer<typeof refundInputSchema>;
```

Add `refundedCents` to `buildOrder` in `db/orders-repository.ts:131` and to
`OrderRow`.

### 3. Repository

New function in `db/orders-repository.ts`:

```ts
/**
 * Record a refund. Additive, because Stripe allows several partial refunds
 * against one charge and each arrives as its own webhook.
 */
export async function recordRefund(orderId: string, amountCents: number): Promise<void>
```

It should `set({ refundedCents: sql`${schema.orders.refundedCents} + ${amountCents}` })`
— an increment in SQL, not a read-modify-write, so two webhooks landing together
cannot lose one.

### 4. Route

In `server/routes/admin.ts`, in the orders section after line 369:

```
POST /api/admin/orders/:id/refund
body: RefundInput
200: { order: Order, emailed: boolean }
```

Behaviour:

- 404 if the order doesn't exist.
- 409 if `order.stripePaymentIntentId` is null — an unpaid or pending order has
  nothing to refund. Note that `stripePaymentIntentId` is on the table but is
  **not** currently on the `Order` schema; add it to `OrderRow` and to
  `buildOrder` output, or fetch it in the repository function. Do not expose it
  through `GET /api/checkout/:sessionId` (`server/routes/checkout.ts:191`) —
  that response is buyer-facing and deliberately narrow.
- 409 if `amountCents` exceeds `totalCents - refundedCents`, message:
  `"That is more than the ${remaining} still refundable on this order."`
- 503 via `toHttp` if Stripe isn't configured (`getStripe()` returns null —
  throw `StripeNotConfiguredError` from `server/stripe.ts` and let `toHttp`
  map it).
- Call `stripe.refunds.create({ payment_intent, amount, reason, metadata: { beluga_order_id: order.id } })`
  with an **idempotency key** of `` `refund-${order.id}-${amountCents ?? "full"}` ``,
  matching the pattern at `server/routes/checkout.ts:162`.
- **Do not** update the order status or `refundedCents` in the route. Let the
  `charge.refunded` webhook do it — invariant 3 in the
  [README](README.md#the-invariants) applies to refunds too, and the webhook is
  already idempotent. The route returns the order as-is; the UI polls.

### 5. Webhook

Update `handleRefund` at `server/routes/webhook.ts:103` to:

- call `recordRefund(orderId, charge.amount_refunded - order.refundedCents)`
  before touching status, so partial refunds accumulate correctly;
- only set status to `refunded` when `charge.amount_refunded >= charge.amount`;
  a partial refund leaves the fulfilment status alone.

`charge.metadata.beluga_order_id` is already set — it comes from
`payment_intent_data.metadata` at `server/routes/checkout.ts:158`. Verify this
holds for refunds created with the metadata above; if Stripe does not copy it,
fall back to looking the order up by `stripePaymentIntentId`.

### 6. Client

`src/admin/queries.ts` — a `useRefundOrder()` hook using `csrfPost`, invalidating
`adminKeys.order(id)` and `adminKeys.orders(...)`.

`src/admin/OrderDetailPage.tsx` — a "Refund" action. Show the refundable
remainder, default the amount field to it, and require a confirmation step:
this is irreversible and outward-facing. When `refundedCents > 0` and less than
`totalCents`, show "Partially refunded — X of Y" near the status tag
(`src/admin/OrderStatusTag.tsx`).

## Acceptance

- Refunding an order with no payment intent returns 409, not a 500.
- Refunding more than the remainder returns 409.
- A full refund moves the order to `refunded` **only after** the webhook lands.
- Replaying the same `charge.refunded` event does not double `refundedCents`.
- The route appears in `MUTATIONS` in `server/security.test.ts` and is rejected
  with 401 anonymously.

## Tests to add

`server/checkout.test.ts` already stubs Stripe; follow its mocking style.

- Refund route rejects anonymous callers (add to `security.test.ts`).
- Over-refund returns 409 with the remaining amount in the message.
- `recordRefund` is additive across two calls.
- A `charge.refunded` with `amount_refunded < amount` leaves status untouched.

## Out of scope

- Refunding individual line items. Amount-based only.
- Restoring inventory — that is [02](02-restock-on-refund.md), deliberately
  separate so this brief stays reviewable.
- A refund reason UI beyond the three Stripe enum values.
