---
task: "12"
title: Abandoned cart recovery
status: in-progress
tier: 3
size: L
migration: one table
blocked_by: ["11"]
blocks: []
touches: db/schema.*.ts · server/routes/webhook.ts:91
completed: 
shipped_in: 
summary: >-
  The cart is deliberately client-side identifiers only, so there is nothing on the server
  to email about. Needs customer accounts, server-side cart persistence and a scheduler —
  three new moving parts, in exchange for the single highest-ROI email in ecommerce. One
  thing to salvage first: `checkout.session.expired` is already handled, so emailing on
  that alone catches the highest-intent abandonment for a fraction of the work.
---

# 12 · Abandoned cart recovery

## Why it's blocked

The cart is client-side identifiers only — nothing about it reaches the server
until checkout starts. There is no row to email about and no address to email it
to. Customer accounts ([11](11-customer-accounts.md)) supply the identity; this
brief supplies the persistence.

There is one thing to salvage first: **`checkout.session.expired` is already
handled** (`server/routes/webhook.ts:91`). An order that reached Stripe and was
abandoned there is already a known, recorded state. Start by emailing on that —
it is a fraction of the work and catches the highest-intent abandonment, the
buyer who reached the payment page. Ship that alone if the rest is deferred.

## What to build

### 1. Persist carts

```ts
export const carts = sqliteTable("carts", {
  id: text("id").primaryKey(),
  customerId: text("customer_id"),
  /** Only for a cart whose owner we may contact. */
  email: text("email"),
  /** JSON: [{ productId, variantId, quantity, options }] — identifiers only. */
  lines: text("lines").notNull().default("[]"),
  currency: text("currency").notNull(),
  recoveryTokenHash: text("recovery_token_hash"),
  reminderSentAt: integer("reminder_sent_at"),
  recoveredAt: integer("recovered_at"),
  ...timestamps,
});
```

**Never store prices or image URLs.** The README's Database section states this
for the client cart and it holds here for the same reason: a price change must
not leave stale amounts in a stored cart. Everything displayable in the recovery
email is derived from the current catalogue at send time.

Sync from the client on a debounce, only when a customer is signed in or has
given an email. A cart for an anonymous visitor who never identified themselves
is not recoverable and should not be stored — storing it is data collection with
no purpose.

### 2. The scheduler

There is no job runner in this project, and adding one is the real cost. Options,
in order of preference:

- **A `setInterval` in the API process**, guarded so only one instance runs it
  (a `advisory lock` on Postgres, a table-based lease on SQLite). Simplest, fits
  the single-process default deployment, and honest about its limits.
- A separate `npm run worker` entry point. Cleaner, but doubles the deployment
  story for a project whose selling point is that SQLite is just a file.

Take the first. Document that a multi-instance deployment needs the lease to
work, and test it.

Send one reminder, once, after a fixed delay (default 4 hours, configurable).
**One email, not a sequence** — a self-hosted store sending three-stage drip
campaigns from the merchant's own SMTP is a deliverability problem, and the abuse
surface of a scheduler that emails on a timer deserves a conservative default.

### 3. Recovery link

`/cart?recover=<token>` — token hashed at rest, single-use, 7-day expiry,
timing-safe compare. Loading it repopulates the cart from the stored identifiers,
re-resolving every line against the live catalogue and **dropping anything no
longer available**, with a message saying what was dropped. Mark `recoveredAt`.

### 4. Consent and opt-out

- Every recovery email needs a working unsubscribe link that sets a suppression
  flag on the customer.
- Do not send to an unverified email — the verification rule from
  [11](11-customer-accounts.md) applies.
- Make the whole feature **off by default** in settings. A merchant must opt in,
  and the settings copy should say the emails come from their SMTP under their
  own sending reputation.

## Acceptance

- A signed-in customer who abandons a cart gets exactly one reminder.
- Recovering restores the cart minus unavailable lines, and says which.
- The token is single-use and expires.
- Unsubscribing stops future sends.
- Two API instances send one email, not two.
- Nothing is stored for an anonymous visitor.

## Out of scope

- Multi-stage sequences, discount incentives in the email, SMS.
- Analytics on recovery rate beyond a count.
