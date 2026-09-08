---
task: "09"
title: Sales tax and VAT
status: done
tier: 2
size: M
migration: product + rate columns
blocked_by: []
blocks: []
touches: server/routes/checkout.ts · server/catalog-sync.ts · src/admin/SetupPage.tsx
completed: 2026-09-08
shipped_in: 
summary: >-
  Every order currently collects zero tax. The recording half already works — the webhook
  reads `amount_tax` and the order page renders a tax line — but nothing ever asks Stripe
  to calculate any. Turning on `automatic_tax` plus `customer_update` is a small diff; the
  real cost is merchant-facing. Stripe Tax is a paid add-on with a registration workflow,
  published products need tax codes, and shipping rates need a tax behaviour. **Most of
  this work is in the setup wizard and the dashboard notices**, explaining an obligation
  the merchant may not know they have.
---

# 09 · Sales tax and VAT

## The problem

**Every Beluga order collects zero tax.** The recording half exists — the webhook
reads `session.total_details.amount_tax` (`server/routes/webhook.ts:73`), the
column is there (`db/schema.sqlite.ts:214`), and both the confirmation page and
the order detail render a tax line. Nothing ever asks Stripe to *calculate* any,
because `checkout.sessions.create` (`server/routes/checkout.ts:138`) does not set
`automatic_tax`.

So the merchant is under-collecting on every sale and owes the difference.

## The shape of this task

Most of the work is **not** code. Enabling `automatic_tax` is a few lines. The
substance is:

- Stripe Tax is a paid add-on the merchant must activate.
- They must register their tax obligations in the Stripe dashboard.
- Every published Stripe Product needs a tax code.
- Every shipping rate needs a tax behaviour.
- Prices must be declared tax-inclusive or tax-exclusive, and that choice differs
  by market — EU stores quote inclusive, US stores exclusive.

**A merchant who turns this on without understanding it will charge wrong.** Budget
the majority of this task for the setup wizard, the dashboard notices, and the
README.

## What to build

### 1. Schema — both dialects

`storeSettings`:

```ts
/** Off until the merchant has activated Stripe Tax and registered. */
taxEnabled: integer("tax_enabled", { mode: "boolean" }).notNull().default(false),
/** "exclusive" (added at checkout) | "inclusive" (already in the price). */
taxBehavior: text("tax_behavior").notNull().default("exclusive"),
/** Stripe tax code applied to products that don't set their own. */
defaultTaxCode: text("default_tax_code").notNull().default("txcd_99999999"),
```

`txcd_99999999` is Stripe's "general — tangible goods". `products`:

```ts
/** Overrides the store default. Null uses it. */
taxCode: text("tax_code"),
```

`shippingRates` (`db/schema.sqlite.ts:187`): a `taxBehavior` column, since
shipping is taxable in some jurisdictions and not others.

### 2. Checkout

In `server/routes/checkout.ts`, when `settings.taxEnabled`:

```ts
automatic_tax: { enabled: true },
customer_update: { shipping: "auto" },
```

`customer_update` is **required** when `automatic_tax` is on and the session
creates a customer — without it Stripe errors at session creation, not at
payment, so it fails loudly in test. Good.

Shipping options built at `server/routes/checkout.ts:124-132` need
`tax_behavior` on their `shipping_rate_data`.

### 3. Publishing

`syncProductToStripe` (`server/catalog-sync.ts:57`) must send `tax_code` on
`products.create` (line 74) and `tax_behavior` on `prices.create` (line 108).

**Two traps:**

- `tax_behavior` is **immutable on a Price**, like `unit_amount`. Changing the
  store's behaviour therefore requires creating new Prices and archiving the old
  ones — exactly what the existing repricing path already does. Make sure a
  behaviour change triggers that path rather than attempting an update.
- Products already published before this lands have no tax code. Publishing is
  explicit and per-product (`server/routes/admin.ts:308`), so add a dashboard
  notice listing products that need republishing, and make the notice link to
  them. Do not auto-republish — that would write to a live Stripe account without
  being asked, which is the v1 mistake the publish gate exists to prevent.

### 4. Wizard and dashboard

`src/admin/DashboardPage.tsx` already has a notices system (see the `title`
entries around lines 141-165). Add:

- Tax is off — "This store is not collecting tax", with a link to Settings and a
  one-line explanation of what to do in Stripe first.
- Tax is on but products lack codes — count and link.
- Tax is on but the Stripe account has no registrations — this requires a call to
  Stripe's Tax Registrations API. If that adds too much surface, instead link to
  the Stripe dashboard and say registrations must exist there. Prefer the link.

In Settings, gate the toggle behind explicit copy: what Stripe Tax costs, that
registration is the merchant's responsibility, and that Beluga does not file
returns.

### 5. Emails and display

`toLocals` (`server/email.ts:48`) already sets `hasTax`/`tax`. With inclusive
pricing the tax line should read "includes $X tax" rather than adding a row —
handle both phrasings.

## Acceptance

- With tax off, sessions are created exactly as today (no `automatic_tax` key).
- With tax on, a test-mode session to a registered jurisdiction returns non-zero
  `amount_tax` and the order records it.
- Switching `taxBehavior` and republishing creates new Prices and archives old
  ones; historic orders still resolve.
- A product with its own `taxCode` sends that, not the default.
- The dashboard names products needing republishing after tax is switched on.

## Tests to add

- `server/checkout.test.ts`: session params include `automatic_tax` and
  `customer_update` only when enabled.
- `catalog-sync`: `tax_code` and `tax_behavior` reach the Stripe stubs; a
  behaviour change produces a new Price rather than an update call.
- A settings round-trip for the three new fields.

## Out of scope

- Beluga-side tax calculation, rate tables, or nexus logic. Stripe Tax or
  nothing.
- Tax reporting, filing, or remittance.
- VAT number collection and reverse-charge handling. Stripe supports collecting a
  tax ID at checkout; treat it as a follow-up.
- Per-jurisdiction product exemptions beyond a single tax code per product.
