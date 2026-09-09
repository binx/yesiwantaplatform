---
task: "19"
title: What a fresh store does not tell its merchant
status: done
tier: 0
size: S
migration: none
blocked_by: []
blocks: []
touches: src/admin/DashboardPage.tsx · src/admin/SettingsPage.tsx · server/routes/admin.ts · server/email.ts
completed: 2026-09-09
shipped_in: 12
summary: >-
  The Overview warns about Stripe, webhooks, email and tax, and says nothing about the
  one default that costs money on the first order: a store with no shipping rates ships
  free. Add that card, one for a shipping table with a coverage gap, a **Send a test
  email** button so a broken `SMTP_URL` is found by the merchant rather than a customer,
  and a pointer from the admin to where discount codes actually live.
---

# 19 · What a fresh store does not tell its merchant

Found on the Overview of a freshly set-up store. Three notices were showing —
Stripe not connected, no email provider, not collecting tax — and none of them
was the one that would have cost money first.

## The problem

**Shipping.** The Shipping page is honest: *No rates, so checkout offers no
shipping and charges nothing for postage.* But that sentence is on a page the
merchant has to think to visit. The Overview, which is where every session
starts, has a `Wiring` block (`src/admin/DashboardPage.tsx:254`) that lists
what is not wired up, and shipping is not in it. A merchant who connects Stripe,
publishes a product and takes an order finds out from the order that postage
was free. `docs/shipping.md` §3.3 calls this the silent failure; the admin
should say it where it is seen.

The same block should cover the second silent case from that section: a zone
table with a coverage gap, which `findCoverageGaps` (`shared/shipping.ts:244`)
already computes and the Shipping page already renders. Anything the Shipping
page would flag in red belongs on the Overview in one line.

**Email.** `SMTP_URL` is a logged no-op until set, which is right. Once it is
set there is no way to find out whether it works short of placing an order. A
transport that authenticates but is refused on `MAIL FROM`, a wrong port, or a
provider that silently drops mail from an unverified sender all present the same
way: the merchant sees nothing, and the first person to notice is a customer
with no confirmation. Settings needs a button that sends one message to the
signed-in administrator and reports the transport's answer.

**Discount codes.** They live in the Stripe dashboard by design (task 03), and
the README explains the trade well. The admin does not: there is no word
"discount" anywhere in it, so a merchant who has read nothing looks for the
feature, does not find it, and concludes it is missing. One card with a link is
enough.

## What to build

### 1 · Shipping on the Overview

`/api/admin/environment` reports server wiring and should stay that way; the
shipping table is store data. Fetch it on the Overview with the same
query the Shipping page uses (`queryKeys.shipping` in `src/admin/queries.ts:40`)
and add two notices to the same list `Wiring` renders,
so they sort with the others:

- **No shipping rates** (`warning`) when `rates.length === 0` and the store has
  at least one live physical product: *Checkout offers no shipping and charges
  nothing for postage. Add a rate under Shipping, or every order ships free.*
  A store selling only downloads does not need this, and `products.kind` says
  which it is.
- **Shipping has a gap** (`warning`) when `findCoverageGaps` returns anything:
  name the first gap the way the Shipping page does and link to it.

Both link to `/admin/shipping`.

### 2 · Send a test email

`POST /api/admin/email/test` on the admin router — inside the
`requireAdmin` + CSRF gate like everything else, with a new entry in
`MUTATIONS` in `server/security.test.ts`. It sends to `req.session`'s
administrator address, never to a body-supplied one, so the route cannot be
used to send mail to strangers. Reuse `sendEmail` (`server/email.ts:261`) with
a short plain template; return the transport's success or the error message
with `{ ok, message }`. Rate-limit it with the email limiter task 08's security
review added, since it is a send.

Settings → Stripe has a sibling card layout; add **Send a test email** to the
email area of Settings (create one if there is none; today SMTP is only
mentioned on the Overview). The button is disabled with a note when
`hasEmail` is false, and shows the returned message inline on success or
failure.

### 3 · Where discount codes are

One `info` card on the Overview, shown only when Stripe is connected:

> **Discount codes** are created and managed in Stripe, and the checkout page
> accepts them. Open the coupons dashboard →

Link to `https://dashboard.stripe.com/coupons` or the test-mode equivalent,
picking by `stripeMode`. The README's Payments section already says why codes
live there; the card links to it rather than repeating it.

## Out of scope

- Any change to how rates are matched, or to the Shipping page itself.
- Sending the test email to an arbitrary address. If a merchant wants to see it
  in another inbox, they can forward it.
- Discount codes in Beluga. Task 03 decided that.

## Definition of done

Per `docs/tasks/README.md`, plus:

- `server/security.test.ts` lists the new route in `MUTATIONS`.
- A server test: the test-email route sends to the session's admin address and
  ignores any `to` in the body.
- Component tests for the two shipping notices: no rates plus a live physical
  product renders the warning; no rates plus only digital products does not; a
  coverage gap renders the second.
- The README's Shipping section gains one sentence saying the Overview warns
  when a store has no rates.
