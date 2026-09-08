---
task: "13"
title: Digital and downloadable products
status: done
tier: 3
size: M
migration: one column
blocked_by: []
blocks: []
touches: shared/shipping.ts · server/routes/checkout.ts · shared/api.ts
completed: 2026-09-08
shipped_in: 1
summary: >-
  Teaches the cart what a download is. `products.kind` splits physical from digital, and
  the collisions follow from it: a download has no weight, so it is left out of parcel
  weight and subtotal banding entirely rather than counted as zero, and a downloads-only
  cart reaches Stripe with no address collection. Finite stock is refused on a digital
  variant rather than letting it register as `oversold`. Delivery — the file, the
  entitlement, the download route — is an open gap, recorded in
  [docs/gaps/digital-delivery.md](../gaps/digital-delivery.md).
---

# 13 · Digital and downloadable products

## The problem

Every product in Beluga was physical. A variant carries `weightGrams`
(`db/schema.sqlite.ts:86`), checkout collected a shipping address
unconditionally, and shipping rates are matched against destination and parcel
weight. There was no way to model a PDF, a font, or a license key.

## What shipped

`products.kind` — `"physical" | "digital"`, defaulting to `"physical"`, with a
**Type** control in the product editor.

**Shipping.** Digital lines are excluded from the parcel rather than weighed as
zero. The zero shortcut is wrong in a way that does not throw: a zero-gram line
still *participates*, so a cart of downloads reports a 0 g parcel, matches the
store's lightest weight band, and the buyer is charged postage on a parcel that
does not exist. `parcelFor` (`shared/shipping.ts`) drops them instead, and
`quoteShipping` reports `requiresShipping: false` — which is a different thing
from "no rates matched", the latter being a coverage gap the merchant needs
telling about.

A downloads-only cart reaches Stripe with `shipping_address_collection` and
`shipping_options` **absent entirely** — not empty, since an empty
`allowed_countries` is a Stripe error and an empty options list still renders
the section. A mixed cart still collects an address, priced on its physical
lines alone. Whether a cart has a physical line is read from the catalogue
inside the loop that already reads prices, so a tampered cart cannot declare
itself digital to skip address collection.

**Subtotal banding.** The brief settled the rule for weight and was silent on
`minSubtotalCents` / `maxSubtotalCents`. The decision taken: subtotal bands see
the physical lines only. The upper bound is what settles it — counting a $600
download toward `maxSubtotalCents` can push a cart past every band's ceiling,
match no rate at all, and ship free with nobody told. `findCoverageGaps` exists
because that failure is invisible. The lower bound matters too, just less: a $45
download must not buy free postage on a $10 tote.

**Inventory.** A download has unlimited stock. `decrementInventoryForOrder`
(`db/orders-repository.ts:328`) already skips variants whose `inventoryType` is
not `"finite"`, but a merchant could set one finite by accident — so `finite` is
refused on a digital variant at `productInputSchema`, and the editor disables
the control rather than letting them reach a validation error with no obvious
cause. Left alone it is a slow failure, not a loud one: the variant counts down,
reaches zero, and paid orders start being flagged `oversold` for a file that
cannot run out.

## What this deliberately did not do

Delivery. There is no file, no entitlement, and no download route — see
[docs/gaps/digital-delivery.md](../gaps/digital-delivery.md), which also carries
the two collisions this brief left open (a `delivered` fulfilment state, and
revoking entitlements on refund). It is a known gap with no chosen approach, so
it is recorded there rather than queued as a task.

None of it can exist before there is a file to point at, so it was left whole
rather than half-built. That includes the security question: **a purchasable
file must not live under the statically-served upload directory.** Nothing in
this task writes a purchasable file anywhere, so that decision is still open and
belongs with that gap.

## Acceptance

- A digital-only cart reaches Stripe with no address collection and no shipping
  options.
- A mixed cart collects an address and prices shipping on the physical lines'
  weight only.
- A digital variant cannot be set to finite inventory.

## Out of scope

- Everything in [docs/gaps/digital-delivery.md](../gaps/digital-delivery.md).
- License-key generation or per-customer watermarking.
- Streaming media, DRM.
- Subscriptions or recurring access — a different Stripe mode entirely.
