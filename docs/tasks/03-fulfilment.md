---
task: "03"
title: "Fulfilment: rate-limit backoff and delivery tracking"
status: in-progress
tier: 0
size: M
migration: one table
blocked_by: []
blocks: ["05", "06"]
touches: server/fulfilment.ts:104 · server/lob.ts:38 · server/routes/webhook.ts · db/orders-repository.ts:462 · src/components/postcard/PostcardSchedule.tsx
completed:
shipped_in:
summary: >-
  **A:** the sweep treats a 429 like any transient failure — the card goes back, the
  attempt counts, and the loop carries on into the same rate limit — so an hour of
  throttling can park a hundred paid cards for a human. Stop the sweep on a global
  condition and don't charge the card for it. **B:** the only status after "Mailed" is
  Lob's expected date. Take Lob's tracking webhooks and show a quiet per-card timeline on
  the order pages. No emails.
---

# 03 · Fulfilment: rate-limit backoff and delivery tracking

## Progress

- **A** built. A 429 or no answer from Lob now stops the sweep and puts the
  card back with its attempt undone (`releasePostcard`); the first 429 of a
  sweep waits for `Retry-After` once. `MAX_ATTEMPTS` is 8. The admin overview
  shows why the last sweep stopped.
- **B** not started.

Two parts. **A is a morning's work and should land first** — it protects
paid cards. **B** is the prerequisite for brief 05's status column and
brief 06's "only after delivery" gate.

## Part A · Rate-limit backoff in the sweep

### The problem

`sendDuePostcards` (`server/fulfilment.ts:104`) does the right thing for a
bad address: record, move on. It does the wrong thing for a rate limit.
`LobError.retryable` is true for 429, 5xx and status 0 alike
(`server/lob.ts:38`), and the loop treats all three the same way:
`markPostcardFailed(…, "retry")`, `attempts` stays incremented from the
claim, next card. But a 429 is not about *that card* — it is Lob telling
this process to stop for a bit. So:

- Every remaining card in the batch hits the same 429 and burns an
  attempt. One throttled sweep costs a hundred cards an attempt each.
- `MAX_ATTEMPTS` is 5, and the sweep runs every fifteen minutes. Seventy-five
  minutes of throttling — or of Lob being unreachable, status 0 — parks
  every due card in `error` for the admin to Retry one by one.

The same is true of status 0 (DNS, timeout, socket): it is the network, not
the card. A 5xx is more ambiguous — Lob may object to one file — and can
stay per-card.

### What to build

1. **Distinguish the global condition.** On `LobError`:

   ```ts
   const globalStall = error instanceof LobError && (error.status === 429 || error.status === 0);
   ```

   For a global stall: release the card **without** counting the attempt,
   record the message, and **stop the sweep**. Add to
   `db/orders-repository.ts`:

   ```ts
   /** Put a claimed card back untouched: the failure was Lob's or the network's, not the card's. */
   export async function releasePostcard(id: string, message: string): Promise<void>;
   // status → 'scheduled', attempts → attempts - 1, lastError → message
   ```

   and set `result.skipped = "Lob rate-limited the sweep; the next tick will
   resume."` (or "Lob could not be reached"). The remaining due cards were
   never claimed, so nothing else needs releasing.

2. **One short in-sweep retry.** Read `Retry-After` when Lob sends it —
   add `retryAfterMs: number | null` to `LobError`, parsed from the header
   in `post()` — and on the *first* 429 of a sweep wait for it (cap 10 s,
   default 5 s) and try the same card once more before stalling. One wait,
   not a loop: the sweep runs inside the API process and must not hold a
   tick for minutes.

3. **5xx stays per-card**, with the attempt counted, as today. Raise
   `MAX_ATTEMPTS` to 8: with the two global cases removed the counter only
   ever sees card-specific server errors, and eight ticks is two hours,
   which is a fairer window for a wobble before a human is asked.

4. **Show it.** `GET /api/admin/fulfilment` currently returns counts by
   status. Add `lastRun: { at, sent, failed, parked, skipped } | null`
   (kept in memory in `fulfilment.ts`; the process restarts, it clears, the
   next tick refills it). `src/admin/DashboardPage.tsx` shows the skipped
   sentence when there is one, in the same warning style as the environment
   checks.

5. **Note the ceiling.** Lob's limit is 150 requests per five seconds. The
   sweep is sequential and each send uploads a print file, so it cannot
   reach that alone; the realistic 429 source is this sweep running next to
   brief 02B's verification traffic or a second instance. Say so in the
   module comment so nobody adds concurrency to "speed it up".

### Acceptance (A)

- Three due cards, Lob answers 429 on the first: the sweep stops, all three
  are `scheduled`, `attempts` is unchanged on all three, `lastError` names
  the rate limit on the first, `SweepResult.skipped` is set.
- Same with a network failure (status 0).
- Three due cards, Lob answers 500 on the second: cards one and three are
  sent, card two is back to `scheduled` with `attempts` 1.
- A 429 with `Retry-After: 2` is retried once after two seconds and, if it
  then succeeds, the sweep continues.

## Part B · Delivery tracking, quietly

### The problem

After a card is sent, the storefront shows "Mailed" and Lob's
`expected_delivery_date` (`PostcardSchedule.tsx:68`). Whether it actually
arrived, was re-routed, or bounced back is only visible in Lob's dashboard.
For the sender that is the whole second half of the experience; for the
admin, a return-to-sender is the earliest signal of a bad address book
entry.

Lob posts tracking events to a webhook. The events that matter, in the
order they happen:

| Lob event | Shown as |
|---|---|
| `postcard.in_transit` | In transit |
| `postcard.in_local_area` | Near its destination |
| `postcard.processed_for_delivery` | Out for delivery (arrives within a business day) |
| `postcard.delivered` | Delivered |
| `postcard.re-routed` | Re-routed |
| `postcard.returned_to_sender` | Returned to sender |
| `postcard.international_exit` | Left the country (02C) |

`postcard.created`, `postcard.rendered_pdf`, `postcard.rendered_thumbnails`
and `postcard.mailed` arrive too; store them, show nothing for them. **Test
mode sends no tracking events**, so the admin's "Send a test postcard"
proves the key but not this; Lob's dashboard has a webhook debugger that
posts sample events (signed with the literal secret `secret`).

**No email, at any stage.** The sender opted into an order confirmation and
a "went to print" note; a day-by-day feed of USPS scans is noise. The
timeline lives on the pages they already have.

### What to build

1. **Env**: `LOB_WEBHOOK_SECRET` (optional). Without it the route answers
   503 and the admin environment panel lists "Lob tracking webhook is not
   configured", the same way it does for Stripe's secret.

2. **Table**, both dialects:

   ```ts
   export const postcardTrackingEvents = pgTable("postcard_tracking_events", {
     /** Lob's event id, `evt_…`, which is what makes a redelivery a no-op. */
     id: text("id").primaryKey(),
     postcardId: text("postcard_id").notNull().references(() => postcards.id, { onDelete: "cascade" }),
     /** Lob's `event_type.id`, verbatim: `postcard.in_transit`. */
     type: text("type").notNull(),
     /** When it happened, from the event's `date_created`. */
     occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
     /** The tracking event's location string, when Lob includes one. */
     location: text("location"),
     ...timestamps,
   }, (t) => [index("postcard_tracking_postcard_idx").on(t.postcardId, t.occurredAt)]);
   ```

   Plus `postcards.tracking_status` text nullable — the latest *shown*
   type, denormalised so the order list and the sweeps do not join.

3. **Route**: `POST /api/webhooks/lob`, mounted in `server/app.ts` **before**
   `express.json()` next to the Stripe one, with `raw({ type: "*/*" })`.
   Verify:

   - `Lob-Signature-Timestamp` is within five minutes of now.
   - `Lob-Signature` equals hex `HMAC-SHA256(secret, `${timestamp}.${rawBody}`)`,
     compared with `safeEqual` from `server/auth.ts:326`.

   Then dedupe with `recordWebhookEvent(`lob:${event.id}`, type)` — the
   existing table, prefixed, since Stripe's ids also begin `evt_` — and
   release with `forgetWebhookEvent` on a handler failure, exactly as
   `webhook.ts` does for Stripe. Find the card by
   `body.metadata.postcard_id`, which `sendPostcard` already sets; fall
   back to `lob_id`. An event for a card this database does not know is
   acknowledged with 200 and logged once; Lob retries anything else.

   Handler: insert the event (ignore a primary-key conflict), and if the
   type is one of the shown ones, set `postcards.tracking_status` when the
   event is newer than the latest stored. `returned_to_sender` also writes
   `lastError = "Returned to sender by USPS"` — our words, not a Lob
   refusal — so the admin's existing error column surfaces it.

4. **Contracts.** `postcardSchema` (`shared/postcards.ts`) gains
   `trackingStatus: z.string().nullable()` and
   `tracking: z.array(z.object({ type, occurredAt, location })).default([])`.
   `buildPostcard` fills them from a join loaded alongside the order's
   postcards (one query per order, not per card). `toCustomerOrder` passes
   both through — there is nothing in them a buyer should not see.

5. **Storefront.** `PostcardSchedule.tsx` is shared by the confirmation
   page and the account order page, which is why the timeline goes there
   and nowhere else. The status cell becomes: the label from
   `customerStatusLabel`, then, for a sent card, a compact vertical list of
   the shown events with their dates — antd `Steps` at `size="small"` with
   `direction="vertical"`, `progressDot`, or a plain `<ol>` styled in
   `Postcard.module.css` if `Steps` fights the table. `returned_to_sender`
   reads "Returned to sender — check the address" in the error colour.
   Labels live in `src/lib/postcards.ts` next to `customerStatusLabel`; the
   raw type never renders.

6. **Admin.** `src/admin/OrderDetailPage.tsx` gets the same list in its
   status column, plus the raw `type` in a tooltip for debugging. The
   orders list gains a filter chip for `returned_to_sender`.

### Acceptance (B)

- A correctly signed `postcard.in_transit` event for a known card inserts
  one row and sets `tracking_status`; posting it again changes nothing.
- A wrong signature answers 400 and inserts nothing; a stale timestamp
  likewise.
- Events arriving out of order (delivered, then in_transit) leave
  `tracking_status` at `delivered`.
- The confirmation page for a guest order shows the timeline without an
  account.
- No email is sent by anything in this part; `sendEmail` is not referenced
  from the new code.

## Tests to add

- `server/fulfilment.test.ts`: the four Part A scenarios above, using the
  existing Lob fake.
- `server/lob.test.ts`: `Retry-After` parsing; the header missing.
- `server/webhook-lob.test.ts` (new): signature good/bad/stale, dedupe,
  unknown card, out-of-order events, cascade on postcard delete.
- `db/dialect.test.ts`: the new table and column on both engines.
- `server/security.test.ts`: the route is public but refuses an unsigned
  body.
- A component test for `PostcardSchedule` rendering three events.

## Out of scope

- Any notification of tracking, by email or otherwise. Deliberate.
- Subscribing to Lob's webhook from code. It is created once in Lob's
  dashboard, pointed at `${PUBLIC_URL}/api/webhooks/lob`; `README.md`
  says so under deployment.
- Backfilling tracking for cards sent before the webhook existed. Lob's
  postcard object carries `tracking_events`; a one-off admin action to pull
  them is a small follow-up if anyone wants it.
