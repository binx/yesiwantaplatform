# 03 · Discount codes via Stripe

**Size** small · **Migration** one column · **Blocked by** nothing

## The problem

Beluga has no discounts of any kind — no schema, no UI, and
`checkout.sessions.create` at `server/routes/checkout.ts:138` does not set
`allow_promotion_codes`, so even codes a merchant creates in their Stripe
dashboard cannot be redeemed. For most merchants evaluating a Shopify
replacement this is the first thing they look for.

## The approach, and its honest limit

Stripe hosts the entire redemption flow: the code field on the checkout page,
validation, expiry, usage caps and per-customer limits. Turning it on is one
line. **The merchant creates and manages codes in the Stripe dashboard, not in
Beluga.** That is the trade this brief takes — it buys a complete, correct
discount feature for a day's work instead of a month's, and it must be stated
plainly in the README rather than left for a merchant to discover.

Do not build a codes CRUD in the admin. If that is wanted later it is a separate
decision, and it means owning validation, race conditions on usage caps, and
Stripe Coupon synchronisation.

## What to build

### 1. Turn it on

In `server/routes/checkout.ts:138`, add to the session params:

```ts
allow_promotion_codes: true,
```

**Ordering caveat:** Stripe rejects `allow_promotion_codes` when `discounts` is
also set. Beluga never sets `discounts`, so this is safe — but do not add both.

### 2. Record what came off

Add to the `orders` table in **both** dialect files:

```ts
/** Total discount applied at Stripe. Zero when no code was used. */
discountCents: integer("discount_cents").notNull().default(0),
```

Add `discountCents: centsSchema` to `orderSchema` in `shared/orders.ts`, to
`OrderRow` and to `buildOrder` in `db/orders-repository.ts:131`.

### 3. Capture it from the webhook

In `handleCheckoutCompleted` (`server/routes/webhook.ts:51`), the session's
`total_details.amount_discount` carries the figure — the same object the existing
line 73 reads `amount_tax` from. Add it to the `PaymentDetails` interface
(`db/orders-repository.ts:254`) and to the `markOrderPaid` update
(`db/orders-repository.ts:273`).

**Watch the subtotal.** Stripe's `amount_subtotal` is pre-discount and
`amount_total` is post-discount, post-shipping, post-tax. The existing code
already takes these from the session rather than recomputing, so the arithmetic
stays consistent as long as `discountCents` is stored as a positive number and
displayed as a deduction. Do not subtract it from `subtotalCents` on the way in.

### 4. Show it

Three places render an order total and all three need a discount row, shown only
when `discountCents > 0` — copy the conditional the tax line already uses:

- `src/pages/ConfirmPage.tsx:141`
- `src/admin/OrderDetailPage.tsx:152`
- `emails/items.hbs` / the `Ordered` template — add a `hasDiscount` boolean and a
  formatted `discount` string in `toLocals` (`server/email.ts:48`), following
  `hasTax` / `tax` on lines 73–74. **Templates do no arithmetic**; format in
  `toLocals`.

Render it as a negative: `−$5.00`.

### 5. Document it

Add a short subsection to the Payments part of `README.md` saying codes are
created in the Stripe dashboard and redeemed on Stripe's hosted page, and that
Beluga records the amount but does not manage the codes.

## Acceptance

- A test-mode promotion code applied at Stripe checkout produces an order whose
  `discountCents` matches, and whose total is the discounted figure.
- An order with no code has `discountCents === 0` and shows no discount row
  anywhere.
- Replaying `checkout.session.completed` does not change the recorded amount.

## Tests to add

In `server/checkout.test.ts`, extend the existing session fixture with
`total_details: { amount_discount: 500, amount_tax: 0 }` and assert the stored
order. Add a case with `amount_discount: 0` asserting the row is zero, not null.

## Out of scope

- Creating, listing or editing codes in the Beluga admin.
- Automatic or cart-condition discounts ("10% off orders over $50"). Those need
  Beluga-side price computation and conflict with invariant 2.
- Free-shipping discounts. Stripe models those separately from amount discounts
  and they interact with the shipping-rate logic in `shared/shipping.ts`.
