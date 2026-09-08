---
task: "16"
title: Digital product delivery
status: todo
tier: 3
size: M
migration: two tables
blocked_by: ["13"]
blocks: []
touches: server/uploads.ts · server/routes/webhook.ts:51 · server/email.ts:132
completed: 
shipped_in: 
summary: >-
  [13](13-digital-products.md) taught the cart what a download *is*; nothing yet delivers
  one. Adds the file itself, the entitlement granted on payment, and an expiring signed
  route that streams it. The failure this feature is known for is storage: a purchasable
  file must **not** live under the statically-served upload directory, or anyone who
  guesses the path has it for free.
---

# 16 · Digital product delivery

## The problem

[13](13-digital-products.md) shipped the modelling half. A product is
`physical` or `digital`, downloads are excluded from parcel weight and subtotal
banding, a downloads-only cart reaches Stripe with no address collection, and a
digital variant cannot be given finite stock.

What it did **not** ship is any way to deliver the thing. There is no file, no
record of who bought it, and no route that serves it. A merchant can currently
mark a product digital, publish it, and take money for it — and then has no
mechanism to give the buyer anything. That is the gap this brief closes.

## What to build

- An `assets` table: `productId`, `variantId` (nullable — a file may cover all
  variants), file path, original filename, size, checksum.
- An upload route and an admin file list on the product editor, modelled on
  `ImageManager` (`src/admin/ImageManager.tsx`).
- An `entitlements` table: `orderId`, `orderItemId`, `assetId`, `tokenHash`,
  `downloadCount`, `maxDownloads`, `expiresAt`, `revokedAt`.
- Granted in `handleCheckoutCompleted` (`server/routes/webhook.ts:51`), inside
  the same idempotent path as everything else there.
- Delivered by a link in the order email, resolving to a route that streams the
  file behind a single-use-ish token: hashed at rest, capped download count,
  30-day expiry, timing-safe compare.

## Storage: the thing to get right

Uploads currently go to the local filesystem under `public/assets/<ownerId>/`
and are served by `express.static` (`server/app.ts:63`, `server/uploads.ts:99`).

A purchasable file **must not** live under a statically-served directory — that
would make it downloadable by anyone who guesses the path, with no entitlement
check at all. Store product files in a separate, non-served directory and stream
them through the authenticated route. **Say this explicitly in the PR**; it is
the failure mode this feature is known for.

Reuse the upload middleware's size limits (`server/uploads.ts:28`) but expect a
much larger cap, and note that `MAX_UPLOAD_BYTES` currently governs images.
Note also that the image path uses `multer.memoryStorage()` because sharp has to
decode the bytes anyway — a 500 MB archive buffered in memory per concurrent
upload is a different proposition, so stream product files to disk under a
generated name and compute the checksum on the way through.

## The two collisions 13 left open

1. **Fulfilment.** The status vocabulary — `processing`, `shipped` — is
   meaningless for a download. `templateForStatus` (`server/email.ts:132`) maps
   `shipped` to a Shipped email that talks about carriers. A digital order
   should go straight to a delivered state with a download email. Adding a
   `delivered` status touches `orderStatusSchema` (`shared/orders.ts:12`), the
   admin fulfilment control, and the CSV export.
2. **Refunds.** [01](01-refund-order.md) and [02](02-restock-on-refund.md): a
   refunded download should have its entitlement revoked, and there is no stock
   to restore. `handleChargeRefunded` (`server/routes/webhook.ts`) already
   restocks on a *full* refund only — revocation belongs on the same branch.

## Acceptance

- A download URL is unguessable, expires, and stops working after the cap.
- The raw file is not reachable under `/assets`, or any other static path.
- A refunded digital order's entitlement is revoked.
- A digital order reaches a delivered state and gets a download email rather
  than a Shipped one that talks about carriers.
- Two concurrent requests on an entitlement with one download left yield one
  file, not two. (The `claimReminder` idiom in `db/carts-repository.ts` is the
  pattern: a conditional `UPDATE`, checked by affected rows.)

## Out of scope

- License-key generation or per-customer watermarking.
- Streaming media, DRM.
- Subscriptions or recurring access — a different Stripe mode entirely.
