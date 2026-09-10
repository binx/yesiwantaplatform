---
task: "05"
title: Sender gallery and send again
status: todo
tier: 2
size: M
migration: none
blocked_by: ["03"]
blocks: ["06"]
touches: server/fulfilment.ts:189 · db/designs-repository.ts · server/routes/account.ts · src/pages/CreatePage.tsx · src/pages/account/AccountNav.tsx
completed:
shipped_in:
summary: >-
  A customer's designs are already theirs (`postcard_designs.customer_id`), but there is
  nowhere to see them: order history is a list of receipts. Add a gallery of everything
  they have designed with where each card went, and the one action that matters — send it
  again, to new people, without re-uploading. That means keeping the print file for
  customer-owned designs, which the cleanup sweep currently deletes.
---

# 05 · Sender gallery and send again

## The problem

`POST /api/designs` records `customerId` when the buyer is signed in
(`server/routes/designs.ts:92`), and an order links back to its designs.
But the account shows orders, not postcards: `/account/orders` is a table
of references and totals, and the only picture of a card is the 64px thumb
in the order detail. Nobody thinks of what they sent as "order 7C3A91F2";
they think of the photo of the dog.

And nothing can be sent twice. `assertOrderable` refuses a design that has
an `orderId` ("already been ordered"), and the cleanup sweep removes the
print file once every card of a design has gone to Lob
(`server/fulfilment.ts:189`) — so even a clone would have nothing to print
from.

## Design decisions

- **A design is one order's.** That rule is load-bearing (the cleanup and
  the "already ordered" check both depend on it) and stays. "Send again"
  *duplicates* the design — files and back — into a fresh row that the
  designer picks up. The gallery groups the copies by their origin.
- **Customer-owned print files are kept.** The trim exists so a public
  upload route is not a free image host. A signed-in customer's design is
  not that; it is their work, and it is what makes send-again exact. A
  4×6 print PNG is 3–5 MB; a prolific customer with a hundred designs is
  half a gigabyte, which is fine on a disk and fine in a bucket. They can
  delete drafts themselves.
- **Guests are unchanged.** Their designs are trimmed and expired exactly
  as today. Signing up later claims their orders (verified email) and, with
  this brief, their designs — but a trimmed print file is gone; those show
  in the gallery as "can't be sent again".

## What to build

### 1. Retention

In `server/fulfilment.ts`'s `cleanUp`:

- `findOrderedDesignsWithPrintFile` takes a filter: only designs whose
  `customerId` is null are trimmed.
- `findOrphanDesigns` splits: guest orphans after 30 days as now;
  customer-owned unbought designs after **180** days, and they are listed
  in the gallery as drafts until then so the deletion is not a surprise.

`claimOrdersForCustomer` (`db/orders-repository.ts:277`) also sets
`postcard_designs.customer_id` on every design of the claimed orders where
it is null. Same transaction shape as the order update.

### 2. Repository

In `db/designs-repository.ts`:

```ts
export interface GalleryDesign extends Design {
  /** Cards on this design, by status, plus the earliest and latest mail dates. */
  postcards: { total: number; scheduled: number; sent: number; delivered: number; error: number; firstMailDate: string | null; lastMailDate: string | null };
  /** The design this one was duplicated from, when it was. */
  originId: string | null;
  canSendAgain: boolean; // printPath !== null
}

export async function listDesignsForCustomer(customerId: string, page: { limit: number; cursor?: string }): Promise<{ designs: GalleryDesign[]; nextCursor: string | null }>;
export async function getDesignForCustomer(id: string, customerId: string): Promise<GalleryDesign | null>;
export async function duplicateDesign(id: string, customerId: string): Promise<Design>; // new id, files copied, back copied, orderId null, originId = id
export async function deleteDraftDesign(id: string, customerId: string): Promise<boolean>; // only when orderId is null
```

`originId` is a new nullable column on `postcard_designs`, both dialects
(this is the one migration, small: one column, no backfill). `delivered`
comes from `postcards.tracking_status` (brief 03B); without it the count
is zero and the label is hidden.

Counts are one grouped query over `postcards` joined on `design_id`, not a
query per design.

`duplicateDesign` copies through `imageStore.get`/`put` — both drivers —
and the two files only; a design with no print file cannot be duplicated
(409). Files are copied before the row is inserted, and removed if the
insert fails, mirroring `POST /api/designs`.

### 3. Routes on `meRouter`

```
GET    /api/account/designs?cursor=      → { designs: GalleryDesign[], nextCursor }
GET    /api/account/designs/:id          → GalleryDesign & { postcards: Postcard[] }   (this customer's cards on it, via toCustomerOrder's rules)
POST   /api/account/designs/:id/duplicate → 201 PostcardDesign
DELETE /api/account/designs/:id          → 204 | 409 "Ordered designs stay in your gallery"
```

`:id` is always filtered by the session's customer in the query — another
customer's design is a 404, the same posture as orders. The `postcards`
list on the detail route strips `lastError`/`attempts` like
`toCustomerOrder` does; brief 06 will also redact a reply's recipient here.

### 4. The gallery page

`/account/postcards`, added to `AccountNav` as **Postcards** between
Overview and Orders. Under `RequireCustomer`, lazy like its siblings.

- A responsive grid (CSS Modules in `Account.module.css` or a new
  `Gallery.module.css`; two columns on a phone, four on a desktop) of
  design cards: the thumbnail (`ProductImage`, `sizes="(max-width: 600px)
  50vw, 25vw"`), the first line of the back text in the design's font,
  and a one-line status: "Sent to 12 people, Sep 2026" / "3 scheduled" /
  "Draft". Newest first; **Load more** with the cursor.
- Clicking opens a detail view (an antd `Drawer` on a phone, a route
  `/account/postcards/:id` on desktop — pick one; the route is simpler and
  linkable): a large thumbnail, the `PostcardBackMock` with the design's
  back, and the per-recipient table using `PostcardSchedule` so the
  timeline from brief 03B appears here too. Duplicates of this design are
  listed under "Sent again on …".
- Actions: **Send again** (calls duplicate, then navigates to
  `/create?designs=<newId>`), **Delete** for drafts only (`Popconfirm`),
  **Download** for the thumbnail (`<a download>` on the asset URL — it is
  the customer's own image).

### 5. The designer receives a design

`CreatePage` reads `?designs=a,b`, fetches `GET /api/designs?ids=` (the
public route the cart already uses), and seeds `designs` with them,
skipping any that are already ordered or missing (with a `message.warning`
saying so). The `DesignForm` is still there for adding more; the
recipients section is empty and waits, and in brief 04A's picker the
customer chooses who gets it. The rest of the page is unchanged.

### 6. Overview

`AccountOverviewPage` gets a row of the three most recent postcards with a
link to the gallery, above the recent orders it presumably already shows.

## Acceptance

- A customer who has sent two batches sees both designs, each with the
  right recipient count and the status of every card.
- "Send again" on a sent design lands on `/create` with the design in the
  schedule, and checkout produces a new order whose cards print the same
  file (compare the copied `print.png` bytes to the original).
- The cleanup sweep no longer removes the print file of a customer-owned
  design; it still removes a guest's.
- A draft is deletable; an ordered design is not.
- Another customer's design id answers 404 on every route.
- A guest who registers and verifies sees their earlier designs, marked
  "can't be sent again" when the file was trimmed before they signed up.

## Tests to add

- `server/fulfilment.test.ts`: trim skips owned designs; orphan expiry uses
  the two windows.
- `db/dialect.test.ts`: `listDesignsForCustomer` counts and cursor;
  `claimOrdersForCustomer` claims designs; `duplicateDesign` copies files
  under the local driver.
- `server/security.test.ts`: the four routes need a customer session; an
  admin session gets 401; IDOR is a 404.
- Component test: the gallery renders a draft and a sent design with the
  right labels.
- e2e: sign in (the `e2e/fixtures` customer), design, order via the
  complimentary admin route or a fake, open the gallery, send again, see
  the design on `/create`.

## Out of scope

- Editing a sent design's back. The duplicate is exact; a new message is
  a new design.
- Hiding or deleting ordered designs. They are the record of what went
  out; the order keeps a foreign key to them.
- Sharing a design publicly. Brief 06 shows a card to its recipient by a
  code; that is a different thing from a public gallery.
- Storage quotas. Revisit if a real customer approaches a gigabyte.
