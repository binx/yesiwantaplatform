---
task: "11"
title: Customer accounts
status: todo
tier: 2
size: L
migration: two tables + orders column
blocked_by: []
blocks: ["12"]
touches: db/schema.*.ts · server/auth.ts · src/router.tsx
completed: 
shipped_in: 
summary: >-
  There is no customers table at all — orders are guest-only, retrieved by an unguessable
  Stripe session id, and a buyer who loses the confirmation email has no way back to their
  order. The hashing and session machinery is reusable, but this still adds storefront
  auth screens, password reset, an address book and an `orders.customerId` backfill. It's
  the keystone of Tier 3: order history, reorder and abandoned-cart recovery all sit
  behind it.
---

# 11 · Customer accounts

## The problem

There is **no customers table**. Orders are guest-only, keyed to an email string
copied from the Stripe session (`db/orders-repository.ts:70`), and the only way
back to an order is the confirmation URL, which is keyed by the unguessable
Stripe session id (`server/routes/checkout.ts:187`). A buyer who loses that email
has no route to their order at all.

No order history, no saved addresses, no reorder, no "where is my parcel".

## Before starting: the security posture

This adds a **public, unauthenticated-facing login surface** to a codebase that
currently has exactly one, heavily-guarded admin login. Treat it accordingly:

- Reuse the argon2id path in `server/auth.ts`, do not write a second one.
- Reuse `loginRateLimit` (`server/middleware.ts:51`).
- **Customer sessions must not grant admin.** `requireAdmin`
  (`server/middleware.ts:76`) reads a session flag; a customer session must set a
  different one, and `server/security.test.ts` must gain a case asserting a
  signed-in customer gets 401 on every admin route. This is the single most
  important test in this brief.
- Account enumeration: login failure, password-reset request, and registration
  with an existing email must all be indistinguishable to an attacker. Always
  respond as if it worked.

## What to build

### 1. Schema — both dialects

```ts
export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  /** argon2id. Null for a guest record created by a checkout. */
  passwordHash: text("password_hash"),
  name: text("name"),
  stripeCustomerId: text("stripe_customer_id"),
  emailVerifiedAt: integer("email_verified_at"),
  lastLoginAt: integer("last_login_at"),
  ...timestamps,
});

export const customerAddresses = sqliteTable("customer_addresses", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  name: text("name"), line1: text("line1").notNull(), line2: text("line2"),
  city: text("city"), state: text("state"),
  postalCode: text("postal_code"), country: text("country").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});
```

Plus on `orders`: `customerId: text("customer_id")`, **nullable** — guest
checkout stays supported and is the default.

### 2. Claiming orders

The interesting design question. An order is created before payment
(`createPendingOrder`) and the email only becomes known when the webhook lands
(`markOrderPaid`, `db/orders-repository.ts:273`).

- If a customer is signed in when checkout starts, set `customerId` then.
- Otherwise, in `handleCheckoutCompleted`, look up a customer by the email Stripe
  returned and link the order if one exists.
- On registration, link **all** existing orders with that email — but **only
  after the email is verified.** Otherwise anyone can register with a stranger's
  address and read their order history, including their shipping address. This
  is the sharpest edge in this brief; do not skip verification here even if you
  skip it elsewhere.

Backfill existing orders by email on migration, for verified customers only —
which at migration time means none. State that plainly rather than quietly
linking.

### 3. Routes

Public, own router, all rate-limited:

```
POST   /api/account/register     { email, password, name? }
POST   /api/account/session      { email, password }        // sign in
DELETE /api/account/session                                  // sign out
GET    /api/account              200: CustomerProfile | 401
PUT    /api/account              { name }
GET    /api/account/orders       200: Order[]                // this customer only
GET    /api/account/orders/:id   200: Order | 404
POST   /api/account/password/forgot  { email }               // always 204
POST   /api/account/password/reset   { token, password }
GET/POST/PUT/DELETE /api/account/addresses[/:id]
```

`/api/account/orders/:id` **must filter by the session's customer id**, not just
look up by order id. An IDOR here exposes another customer's address.

Reuse `verifyCsrf` on every mutation. The session cookie config in
`server/app.ts:29-47` already applies.

Password minimum: reuse the 12-character rule from `setupInputSchema`
(`shared/api.ts:78`) rather than inventing a second bar.

### 4. Email

`server/email.ts` is order-shaped — `sendOrderEmail(template, order)`. Generalise
it: extract the render-and-send core, keep `sendOrderEmail` as a wrapper, and add
templates `VerifyEmail` and `ResetPassword` under `emails/`, following the
existing `subject.hbs` / `body.hbs` / `layout.hbs` structure.

Reset tokens: store a **hash**, single-use, 1-hour expiry, timing-safe compare —
same rules as the invite tokens in [07](07-staff-accounts.md). If both land,
share one helper.

### 5. Storefront

New pages under `/account` in `src/router.tsx`, guarded by a customer equivalent
of `src/admin/RequireAdmin.tsx`. Sign in, register, order history, order detail,
addresses, forgot/reset.

At checkout: prefill from the default address when signed in, and offer sign-in
without forcing it. **Guest checkout must remain the default path** — requiring
an account is a well-documented conversion loss and this project's existing
posture is to keep the buyer's path short.

Pass `customer_email` to `checkout.sessions.create` when signed in, so the buyer
does not retype it.

## Acceptance

- A customer signed in on the storefront gets 401 on every `/api/admin/*` route.
- Order detail for another customer's order is a 404, not a 403 with contents.
- Registration with an existing email is indistinguishable from a new one.
- Orders are claimed only after email verification.
- Guest checkout still works end to end with no account.
- Reset tokens are single-use and expire.

## Tests to add

- **In `server/security.test.ts`:** a customer session against every entry in
  `MUTATIONS` and `READS` expects 401.
- IDOR: customer A requesting customer B's order gets 404.
- Enumeration: identical responses and comparable timings for known and unknown
  emails on login and forgot-password.
- Claiming: unverified registration does not link orders; verifying does.

## Out of scope

- Social or passwordless login.
- Stored payment methods. Stripe's hosted checkout owns card data and this
  project stays SAQ-A — do not touch this.
- Wishlists, loyalty, or store credit.
- Customer management in the admin beyond a read-only list, if you add one at all.
