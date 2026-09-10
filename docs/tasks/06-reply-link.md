---
task: "06"
title: Reply link
status: done
tier: 3
size: L
migration: columns on postcards, orders, customers
blocked_by: ["03", "05"]
blocks: []
touches: print/back.hbs · src/components/postcard/PostcardBackMock.tsx · shared/cart.ts:24 · server/routes/checkout.ts:37 · server/routes/account.ts:82 · db/orders-repository.ts:38
completed: 2026-09-10
shipped_in: "#13"
summary: >-
  Every card gets a QR code printed on the back. Holding the card is the credential:
  the code opens the card online and — when the sender has opted in with a return
  address — lets the recipient send a postcard back without ever seeing that address.
  **A:** code and landing page. **B:** the reply order. The reaction in the original
  spec was cut at review. Chains and prepaid replies are named and left for later.
---

# 06 · Reply link

Two phases. **A** needs brief 03B's tracking (the page goes live only once
the card has arrived) and is worth shipping on its own. **B** needs brief 05's account surfaces
and a return address on the sender's account.

## Progress

Built as one PR, both phases, with three amendments from review:

- **The back carries a QR code, not a printed URL.** The code is still the
  eight-character token and the page is still `/r/CODE`, but the only
  thing on the card is a 0.6in QR (drawn server-side with `qrcode`, inline
  SVG in `print/back.hbs`) and the caption "Scan to see this card online,
  or to send one back." Stores on a Lob-hosted template get the URL as the
  `reply_url` merge variable and draw their own.
- **Opening the page records nothing.** There is no `first_viewed_at`, no
  "seen online" event, and no timeline entry when the recipient looks. A
  reader's visit is their own business.
- **No reaction.** The "it arrived" tap with an emoji and a note was cut
  at review. The page does two things: shows the card, and offers to send
  one back. There is no `postcard_reactions` table and no
  `POST /api/r/:code/reaction`; the sections below that describe them are
  the original spec, kept for the record.

Everything else is as specified: the gate (sent, not disabled, tracking
says landed or seven days since mailing), the per-batch checkbox (default
on), the sender's "turn off the link", the reply address on the account,
server-side resolution at checkout, the cap of three paid replies per
card, and redaction in `toCustomerPostcard` and the emails. The e2e
coverage is the accessibility sweep of `/r/…`; the full flow is covered in
`server/reply.test.ts`.

## The idea, and the property it rests on

A postcard is a physical object in one person's hands. Print an eight-
character code on it and *possession of the card* becomes a bearer token
for "I received this". That one property makes three things safe to offer,
in increasing cost:

1. **See it online.** `/r/AB7X3KQM` shows the front and the message. People
   keep cards on the fridge; a copy they can save is a small gift.
2. **Say it arrived.** One tap, optional 140-character note. The sender
   sees it on their order page next to that recipient. It is the
   human-confirmed delivery no tracking event can give, and it costs the
   recipient nothing.
3. **Send one back.** The designer opens with the recipient locked to "the
   person who sent you this", address hidden. The replier pays the normal
   price. The sender's address is resolved on the server and never leaves
   it.

Two people who each sent nothing but a photo now have an exchange, and the
second one arrived at the site through the mail.

## Design decisions

- **One code per postcard row**, not per order. Each row is one card to one
  person, so a reaction says *which* recipient reacted. Eight characters
  from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no 0/O/1/I/l — it is typed from
  paper): 32⁸ ≈ 10¹² codes, so guessing is pointless, but the lookup route
  is rate-limited anyway.
- **The sender opts in per batch, default on.** A checkbox on the schedule
  panel: "Print a link on the back so they can see it online and reply."
  The front image becomes viewable by whoever holds the code; that is the
  sender's call. Guests get the checkbox too — reactions show on the
  confirmation page, which a guest keeps — but "send one back" needs an
  account with a return address.
- **Nothing is live before the card lands.** The page answers 404 until
  the card's tracking says `processed_for_delivery` or `delivered`, or
  seven days after `sentAt` when tracking is absent. A code printed on a
  card in the post is not yet a key to anything.
- **The replier never sees the address.** Not in the API, not in the cart,
  not on the confirmation page, not in the emails. `toCustomerOrder` is
  the one gate and it is tested.
- **The sender's address is snapshotted at reply checkout.** It goes onto
  the postcard row like any recipient, so the sweep needs no special case
  and a sender who moves later does not strand a paid reply. The sender
  can turn replies off for a card at any time; that only affects new
  replies.
- **Don't spoil the reply.** The sender's order page says "A reply is on
  its way" from the moment a reply is paid, and shows the reply's front
  only after that card's tracking says delivered. The surprise is the
  point of a postcard.
- **Guest checkout stays** for the replier. An email is enough, as it is
  for any order. The account prompt afterwards is where the loop closes.

## Phase A · Code, page, reaction

### 1. Schema, both dialects

```ts
// postcards
replyCode: text("reply_code"),                 // null when the sender opted out
replyDisabledAt: timestamp("reply_disabled_at", { withTimezone: true }),
firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
// unique index on reply_code

// new
export const postcardReactions = pgTable("postcard_reactions", {
  postcardId: text("postcard_id").primaryKey().references(() => postcards.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),              // one of REACTIONS
  note: text("note"),                          // ≤ 140 chars, emoji stripped like the back
  ...timestamps,
});
```

One reaction per card; a second submission replaces it.

`cartLineSchema` (`shared/cart.ts:24`) gains `replyLink: z.boolean()
.default(true)`; `createPendingOrder` (`db/orders-repository.ts:38`)
generates a code for each postcard when it is true. Generation retries on
a unique-index collision — with 10¹² codes it will not happen, and the loop
is three lines.

### 2. On the card

`print/back.hbs` gets a footer inside the message column, when `replyUrl`
is set:

```html
<div class="reply">See it online or send one back: <b>{{replyUrl}}</b></div>
```

7 pt, the message's colour at 70 %, pinned to the bottom of `.safe` with
`margin-top: auto`, so the message column shrinks by one line. Optional
QR: `replyQr` as an SVG data URI generated server-side with the `qrcode`
package (one small dependency; confirm Lob's renderer accepts inline SVG
data URIs on the first test card, else render to PNG). 0.7 in square,
bottom-left of the column, only when the sender ticks "Add a QR code"
(default off — it takes message space). The Lob-template fallback
(`LOB_BACK_TEMPLATE_ID`) gets `reply_url` as a merge variable and the
template is edited once in Lob's dashboard.

`PostcardBackMock.tsx` draws the same footer from the same inch values so
the buyer sees the line it costs them. The URL is
`${PUBLIC_URL}/r/${code}` with the scheme dropped for print:
`postcardgifts.com/r/AB7X3KQM`.

`sendPostcard` takes `replyUrl: string | null`; the sweep passes it from
the row.

### 3. Public routes

A new `replyRouter` at `/api/r`, `verifyCsrf`, its own limiter
(`replyRateLimit`, 60 per hour per IP):

```
GET  /api/r/:code           → ReplyCard | 404
POST /api/r/:code/reaction  → 204 | 404 | 400
```

```ts
export const REACTIONS = ["❤️", "😂", "🥹", "😮", "👋"] as const;

export const replyCardSchema = z.object({
  /** The 600px thumbnail — the print file is never served. */
  front: imageSchema,
  orientation: orientationSchema,
  back: postcardBackSchema,
  /** The sender's chosen name, or null for a guest sender. */
  senderName: z.string().nullable(),
  mailedOn: mailDateSchema,
  canReply: z.boolean(),
  reaction: z.object({ emoji: z.enum(REACTIONS), note: z.string().nullable() }).nullable(),
});
```

`GET` answers 404 unless: the code exists, `replyDisabledAt` is null, and
the card is sent *and* landed (tracking status in
`{processed_for_delivery, delivered}` or `sentAt` ≥ 7 days ago). It sets
`firstViewedAt` on the first hit. `canReply` is true when the sender is a
customer with a reply address (Phase B) and `replyDisabledAt` is null.

The reaction `POST` validates `{ emoji, note }`, upserts, and answers 204.

### 4. The page

`/r/:code`, eager route, `PageWrapper width="narrow"`, title "A postcard
for you". Layout, top to bottom:

- The front, large, in a card with a subtle shadow (new
  `ReplyPage.module.css`; the `.backCard` treatment in
  `Postcard.module.css` is the model). A portrait design shows portrait.
- The back's message, in the design's font, colour and size, via a
  `PostcardBackMock` variant with the address block hidden.
- "From {senderName}, mailed {date}" — or just the date for a guest.
- **Let {senderName} know it arrived**: five emoji buttons (44 px targets,
  `aria-label` each) and a note field that appears after one is chosen,
  with **Send**. After sending, the row shows the chosen emoji and "Sent
  to Rachel" and can still be changed.
- When `canReply`: a primary **Send a postcard back** button →
  `/create?replyTo=CODE`. When not, nothing — do not advertise a thing the
  page cannot do.
- A one-line footer: "Made with Postcard Gifts — send one to someone" →
  `/create`. This is the whole acquisition funnel; keep it one line.

`server/seo.ts` gives the page a generic title and the store's image, never
the card — link previews in a group chat should not reveal the front.

### 5. What the sender sees

`postcardSchema` gains `reaction` and `firstViewedAt` (both nullable);
`toCustomerOrder` passes them through. `PostcardSchedule.tsx` shows, under
the tracking timeline: "Seen online Sep 20" and the emoji with the note in
quotes. The confirmation page gets it for guests; the account order page
and brief 05's gallery detail for customers.

Per card, a small **Turn off the link** action on the customer's order
page (`POST /api/account/orders/:id/postcards/:postcardId/reply/disable`,
on `meRouter`) sets `replyDisabledAt`; the page goes 404 and the reply
button disappears. There is no undo, by design: turning it back on after
turning it off is a decision to make from the admin if ever needed.

### Acceptance (A)

- A card ordered with the box ticked prints a footer with a code, and the
  mock shows it; unticked prints and shows nothing.
- `/r/CODE` is 404 while the card is scheduled or just sent, and 200 once
  the tracking says delivered or seven days pass.
- A reaction with a note appears on the sender's confirmation page within
  one refetch; a second reaction replaces the first.
- `GET /api/r/CODE` never includes a recipient address or the print path.
- The page's link preview shows the store, not the card.

## Phase B · Send one back

### 1. Schema

```ts
// customers
replyAddress: jsonb("reply_address"),        // Recipient shape; null = replies off
replyDisplayName: text("reply_display_name"),
// orders
replyToPostcardId: text("reply_to_postcard_id").references(() => postcards.id, { onDelete: "set null" }),
// postcards
isReply: boolean("is_reply").notNull().default(false),
```

### 2. Sender setup

On `AccountOverviewPage`, a **Replies** section: "Let people you send to
send one back" with a display name (default the first word of
`customers.name`) and a mailing address through `RecipientFields` with
brief 02B verification. `PUT /api/account/reply-address` on `meRouter`;
`DELETE` to turn it off. Both dialects store the address as JSON.

### 3. The cart line

`cartLineSchema` gains `replyTo: z.string().length(8).nullable()
.default(null)`, and `recipients` becomes `min(0)` with a `superRefine`:
exactly one of `replyTo` or a non-empty `recipients`. `countPostcards`
counts a reply line as `designs.length × 1`.

### 4. The designer

`CreatePage` reads `?replyTo=`, fetches `GET /api/r/:code`, and when
`canReply`:

- The recipients panel is replaced by a locked card: "To **Rachel** — the
  address is kept private and added when you check out." No form, no CSV,
  no saved list.
- The schedule works as normal (a reply can be timed too).
- The reply checkbox is on for the reply, so the exchange can continue.
- The cart line carries `replyTo`.

When the code is unknown or `canReply` is false, the page loads normally
with a `message.info`: "That card can't be replied to any more." and no
lock.

### 5. Checkout

In `assertOrderable` (`server/routes/checkout.ts:37`) and the
complimentary route, a line with `replyTo`:

- resolves the code → postcard → order → customer → `replyAddress`; any
  link missing, or `replyDisabledAt` set, is 409 "That card can't be
  replied to."
- caps replies at three paid orders per code (a count on
  `orders.reply_to_postcard_id`) — 409 past that.
- substitutes `recipients = [replyAddress]` **inside the server** before
  `createPendingOrder`, which writes the postcard rows with `isReply: true`
  and the order with `replyToPostcardId`.

Stripe sees a normal one-card line item. The `Ordered` and `PostcardSent`
emails render `formatRecipient`; for a reply card they must render the
display name only — add `recipientLine` helper in `server/email.ts` that
checks `isReply`.

### 6. Redaction — the test that matters

`toCustomerOrder` (`server/routes/account.ts:82`) becomes the place where
a reply card's recipient is replaced:

```ts
recipient: postcard.isReply
  ? { ...postcard.recipient, line1: "", line2: null, city: "", state: "", postalCode: "" }
  : postcard.recipient,
```

with `name` kept (the display name the sender chose). `PostcardSchedule`
renders a reply card as "To Rachel · address kept private". The confirm
page, the account order routes, and brief 05's design detail all go
through this function; the admin routes do not, and the admin sees the
address, which is right.

### 7. What the original sender sees

On the original card's row: "A reply is on its way" once a reply order is
paid; when that reply card's tracking reaches delivered, the row shows the
reply's thumbnail with "They sent one back". `getOrder` loads replies by
`orders.reply_to_postcard_id` for the order's postcard ids in one query.

### Acceptance (B)

- A replier with only the code completes checkout; the resulting postcard
  row carries the sender's address; every customer-facing JSON for that
  order has empty address fields on that card; the emails show the name
  only.
- A sender with no reply address gets `canReply: false` and no button.
- Turning replies off after a reply is paid does not affect that reply.
- The fourth reply order on one code is refused.
- The sender's order page shows "A reply is on its way" and, after a
  delivered tracking event on the reply card, its thumbnail.

## Tests to add

- `shared/*.test.ts`: code alphabet and length; the cart refinement.
- `db/dialect.test.ts`: the new columns and table; the unique code index.
- `server/reply.test.ts` (new): the 404 gate against each tracking state
  and the seven-day fallback; reaction upsert; disabled codes; rate limit.
- `server/checkout.test.ts`: reply resolution, the cap, the redaction —
  **assert the string of the sender's `line1` appears nowhere in the
  customer-facing order JSON or in the rendered email HTML.**
- `server/security.test.ts`: the new `meRouter` routes; the public routes'
  limiter.
- `server/lob.test.ts`: `renderBack` with and without `replyUrl`, and the
  Lob-template merge variable.
- e2e: sender orders with the link on; simulate delivery by inserting a
  tracking row; open `/r/CODE`, react, see it on the confirmation page;
  then `/create?replyTo=` through to the cart with the locked recipient.

## Out of scope, named so they stay ideas

- **Threads.** A reply carries its own code, so an exchange is already a
  chain in the data. Rendering it as a conversation in the gallery is a
  small follow-up once B is real.
- **Prepaid replies.** "This one's on me": the sender buys a reply credit
  and the replier's checkout is free. Cheapest route is a single-use 100 %
  Stripe promotion code minted per postcard at order time and printed with
  the URL; it needs a decision about refunds and expiry first.
- **Moderation of what a replier uploads.** The same exposure as any
  upload, and `docs/NEXT-STEPS.md` §7's review hold is the answer for both.
- **A public gallery of cards.** The code is a private key to one card.
