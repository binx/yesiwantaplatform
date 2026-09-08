---
task: "13"
title: Digital and downloadable products
status: in-progress
tier: 3
size: M
migration: one table
blocked_by: []
blocks: []
touches: shared/shipping.ts · db/orders-repository.ts:328 · server/uploads.ts
completed: 
shipped_in: 
summary: >-
  Entitlements granted on payment and served over expiring signed URLs. Note the
  collisions with existing rules: a download has no weight, so it must skip shipping-zone
  matching entirely rather than register as zero-weight, and it needs to bypass the
  inventory decrement rather than register as `oversold`. The purchasable file must not
  live under the statically-served upload directory.
---

# 13 · Digital and downloadable products

## Status: the modelling half has landed, delivery has not

Split deliberately, because the two halves have different risk. What has
shipped is everything that decides *how a download behaves in a cart*:

- `products.kind`, with a **Type** control in the product editor.
- Shipping skips digital lines rather than weighing them as zero — for the
  parcel weight *and* for the subtotal a rate is banded against. A cart of
  downloads reaches Stripe with no `shipping_address_collection` and no
  `shipping_options`; a mixed cart collects an address and prices on its
  physical lines alone.
- Finite inventory is refused on a digital variant at the input schema, so it
  can never register as `oversold`.

Deferred, and still to do — this is collision 3 and 4 below, plus all of
**What to build**:

- The `assets` table, the non-served storage directory, and the upload route.
- `entitlements`, granted in `handleCheckoutCompleted`.
- The signed download route, its expiry and download cap.
- The `delivered` state and the download email.
- Revoking entitlements on refund.

None of it can exist before there is a file to point at, so it was left whole
rather than half-built. **The security note under "Storage" below is the
reason to be careful here: the purchasable file must not live under the
statically-served upload directory.** That question is untouched — nothing in
this pass writes a purchasable file anywhere.

One decision worth recording, because the brief does not settle it: **subtotal
bands see the physical lines only.** The brief fixes the rule for weight and is
silent on `minSubtotalCents` / `maxSubtotalCents`. Physical-only was chosen
because the upper bound is the dangerous direction — counting a $600 download
toward the subtotal can push a cart past every band's ceiling, match no rate,
and ship free with nobody told. `findCoverageGaps` exists because that failure
is invisible.

## The problem

Every product in Beluga is physical. A variant carries `weightGrams`
(`db/schema.sqlite.ts:86`), checkout collects a shipping address unconditionally
(`server/routes/checkout.ts:151`), and shipping rates are matched against
destination and parcel weight. There is no way to sell a PDF, a font, or a
license key.

## The collisions to handle

These are the reason this is not a simple feature. Each needs a deliberate
decision, and an agent that misses one will ship something subtly wrong.

1. **Shipping.** A digital-only cart must set **no** `shipping_address_collection`
   and **no** `shipping_options`. A mixed cart — one PDF, one tote — must still
   collect an address and must weigh only the physical lines. `quoteShipping`
   (`server/routes/shipping.ts`) and the weight banding in `shared/shipping.ts`
   both need to skip digital lines rather than treat them as zero-weight, which
   would silently qualify a cart for a light-parcel rate.
2. **Inventory.** A download has unlimited stock. `decrementInventoryForOrder`
   (`db/orders-repository.ts:328`) already skips variants whose `inventoryType`
   is not `"finite"`, so setting digital variants to `"infinite"` works — but a
   merchant could set one finite by accident. Reject `finite` inventory on a
   digital variant in the input schema rather than letting it register as
   `oversold`.
3. **Fulfilment.** The status vocabulary — `processing`, `shipped` — is
   meaningless for a download. `templateForStatus` (`server/email.ts:132`) maps
   `shipped` to a Shipped email that talks about carriers. A digital order
   should go straight to a delivered state with a download email.
4. **Refunds.** [01](01-refund-order.md) and [02](02-restock-on-refund.md): a
   refunded download should have its entitlement revoked, and there is no stock
   to restore.

## What to build

- `products.kind` — `"physical" | "digital"`, defaulting to `"physical"`.
- An `assets` table: `productId`, `variantId` (nullable — a file may cover all
  variants), file path, original filename, size, checksum.
- An `entitlements` table: `orderId`, `orderItemId`, `assetId`, `tokenHash`,
  `downloadCount`, `maxDownloads`, `expiresAt`, `revokedAt`.
- Granted in `handleCheckoutCompleted` (`server/routes/webhook.ts:51`), inside
  the same idempotent path as everything else there.
- Delivered by a link in the order email, resolving to a route that streams the
  file behind a single-use-ish token: hashed at rest, capped download count,
  30-day expiry, timing-safe compare.

**Storage.** Uploads currently go to the local filesystem under
`public/assets/<ownerId>/` and are served by `express.static`
(`server/app.ts:63`, `server/uploads.ts:99`). A purchasable file **must not** live
under a statically-served directory — that would make it downloadable by anyone
who guesses the path, with no entitlement check. Store product files in a
separate, non-served directory and stream them through the authenticated route.
Say this explicitly in the PR; it is the failure mode this feature is known for.

Reuse the upload middleware's size limits (`server/uploads.ts:28`) but expect a
much larger cap, and note that `MAX_UPLOAD_BYTES` currently governs images.

## Acceptance

- A digital-only cart reaches Stripe with no address collection and no shipping
  options.
- A mixed cart collects an address and prices shipping on the physical lines'
  weight only.
- A download URL is unguessable, expires, and stops working after the cap.
- The raw file is not reachable under `/assets`.
- A refunded digital order's entitlement is revoked.
- A digital variant cannot be set to finite inventory.

## Out of scope

- License-key generation or per-customer watermarking.
- Streaming media, DRM.
- Subscriptions or recurring access — a different Stripe mode entirely.
