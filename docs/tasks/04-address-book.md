---
task: "04"
title: Address book and ask-for-address links
status: todo
tier: 2
size: L
migration: columns on customer_addresses + one table
blocked_by: ["02"]
blocks: []
touches: db/customers-repository.ts:87 · src/pages/account/AccountAddressesPage.tsx · src/components/postcard/Recipients.tsx:278 · server/routes/account.ts:260 · shared/account.ts
completed:
shipped_in:
summary: >-
  Saved recipients already exist — filled from paid orders, editable, pickable in the
  designer. **A** turns the list into an address book: labels, tags for one-click groups,
  birthdays that feed the schedule, notes, search, export. **B** solves the problem in
  front of all of it — not knowing a friend's address — with a link the friend fills in
  themselves, landing straight in the book.
---

# 04 · Address book and ask-for-address links

Two parts. **A first**: B writes into the fields A adds. Both depend on
brief 02B for the verification step on the public form.

## What already exists

Beluga's customer accounts came through the fork intact: `customers`,
`customer_addresses`, `POST/PUT/DELETE /api/account/addresses`,
`AccountAddressesPage.tsx`, and the **Saved recipients** picker in the
designer (`Recipients.tsx:278`). `saveRecipientsFromOrder`
(`db/customers-repository.ts:87`) adds every recipient of a paid order,
deduplicated on the whole address. `docs/NEXT-STEPS.md` calls this "customer
accounts with saved recipients". So the address book is not new; it is
flat.

## Part A · An address book, not a list

### The problem

Fifty saved recipients is a wall of cards sorted by name. There is no way to
say "the holiday list", nothing remembers *when* you last sent to someone,
nothing knows a birthday, and the picker in the designer is a checkbox list
with no search. The site's pitch is batches; the batch a real person sends
is "everyone tagged *family*".

### What to build

1. **Columns** on `customer_addresses`, both dialects:

   ```ts
   /** What the customer calls them: "Mom", "the Okafors". The card still prints `name`. */
   label: text("label"),
   /** Free tags, lowercase, for grouping. JSON array; text in SQLite. */
   tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
   /** MM-DD, or YYYY-MM-DD when the year is known. Feeds the schedule. */
   birthday: text("birthday"),
   notes: text("notes"),
   /** How this entry arrived: a paid order, typed by hand, or a request link (Part B). */
   source: text("source").notNull().default("order"),
   /** Most recent paid order that mailed to this address. */
   lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
   /** From brief 02B. */
   verifiedAt: timestamp("verified_at", { withTimezone: true }),
   ```

   `saveRecipientsFromOrder` changes from "skip if seen" to "update
   `lastSentAt` if seen, insert otherwise". `addressInputSchema`
   (`shared/account.ts`) extends `recipientSchema` with the optional
   fields; tags are validated as `z.array(z.string().trim().toLowerCase()
   .min(1).max(24)).max(10)`; birthday as `^(\d{4}-)?\d{2}-\d{2}$`.

2. **The account page.** Keep the card layout (`Account.module.css` `.card`,
   `.cardHeader`, `.meta`) and add, above the list: a search `Input`
   (client-side filter on name, label, city, tags) and a row of tag chips
   (antd `Tag.CheckableTag`) that filter the list. Each card shows the
   label in bold with the printed name beside it, the address, tags, "Last
   sent {date}", and the next birthday when set. The edit form
   (`RecipientForm`) gains label, tags (`Select mode="tags"`), birthday
   (a date input; a checkbox "I don't know the year" stores MM-DD), notes
   (`TextArea`, 500 chars), and reuses `RecipientFields` from brief 02B so
   verification and the country select come for free.

   **Export** — a button that builds a CSV client-side with `csvRow` from
   `shared/csv.ts`, columns matching `SAMPLE_CSV` plus `country`, `label`,
   `tags` (pipe-separated), `birthday`, so the file round-trips through the
   importer (brief 02A ignores the extra columns it does not know).
   `<a download>` with a data URL, the same way the sample CSV is offered.

3. **The picker in the designer** (`SavedRecipientsModal`): the same search
   box and tag chips, **Select all shown**, and each row's label + last-sent
   date. Choosing a tag and "Select all" is the one-click batch.

4. **Birthdays into the schedule.** When brief 00's custom mode is on and a
   recipient with a birthday is added, the schedule shows a one-line offer
   under the date row: "Maya's birthday is Oct 14 — mail it Oct 6 to arrive
   in time?" with a button that writes the computed date. Uses
   `addDaysIso(birthday, -7)`, the same lead brief 00's control defaults to. Only for a line with exactly one
   recipient; a batch to twelve people has no single birthday. If brief 00
   has not landed, skip this step and note it in the PR.

5. **Two addresses for one person.** When a paid order's recipient matches
   an existing entry on `name` but not on the address, insert the new one
   with `label` copied from the old and leave both. Do not guess which is
   current. The page shows them next to each other because it sorts by
   name.

### Acceptance (A)

- A customer with 60 entries can find one by typing three letters of a
  city, and can add everyone tagged `holiday` to a batch in two clicks.
- Ordering to an existing entry updates its "Last sent" and adds no
  duplicate.
- The exported CSV re-imports through the designer with no problems
  listed.
- A birthday entered as MM-DD renders "Oct 14" with no year.

## Part B · Ask a friend for their address

### The problem

Every recipient flow — form, CSV, saved list — assumes the sender *has* the
address. Most of the time the reason a postcard does not get sent is that
they do not, and asking "hey what's your address" over text is the friction.
Give the sender a link; the friend types it once; it lands in the book.

### Design decisions

- **Two link shapes.** A *single* link is for one person: the first
  response fills it and later visits see "already sent". A *collector*
  link stays open and takes many responses ("send me your address for the
  holiday card"), each a new entry.
- **The token is stored in the clear.** Beluga stores every token-shaped
  thing hashed (`hashToken`, `server/auth.ts:171`). This one is the
  exception, on purpose: the requester has to re-copy a collector link for
  weeks, and what the token unlocks is submitting one address into
  someone's book and reading their first name. A leaked database makes
  nothing of that worse. Say this in the schema comment so the exception
  is not "fixed".
- **No account for the responder.** They see a first name, a sentence
  about why, and a form. No sign-up, no cookie beyond the CSRF session
  every storefront page already has.
- **The requester's display name is required.** `customers.name` is
  nullable; creating a request when it is null prompts for it first
  (`PUT /api/account` exists). "Someone would like your address" is not a
  page anyone should fill in.
- **Notify the requester, not the recipient.** An optional email to the
  *requester* when a response arrives — the person who asked, opting in per
  link. Nobody emails the friend; the friend was sent the link by the
  requester in whatever channel they use.

### What to build

1. **Table**, both dialects:

   ```ts
   export const addressRequests = pgTable("address_requests", {
     id: text("id").primaryKey(),
     customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
     /** Stored raw — see the brief for why this is the one unhashed token. 32 bytes base64url. */
     token: text("token").notNull(),
     /** "Maya", or "Holiday card 2026". Shown to the requester only. */
     label: text("label").notNull(),
     /** Collector links take many responses; single links take one. */
     multi: boolean("multi").notNull().default(false),
     /** open | fulfilled | revoked. Expiry is `expiresAt`, checked at read time. */
     status: text("status").notNull().default("open"),
     notifyByEmail: boolean("notify_by_email").notNull().default(true),
     responses: integer("responses").notNull().default(0),
     expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
     ...timestamps,
   }, (t) => [uniqueIndex("address_requests_token_idx").on(t.token), index("address_requests_customer_idx").on(t.customerId)]);
   ```

   Plus `customer_addresses.request_id` text nullable, so a response knows
   which link it came from and the page can show "via your link".

2. **Contracts** in `shared/account.ts`:

   ```ts
   export const addressRequestInputSchema = z.object({
     label: z.string().trim().min(1).max(80),
     multi: z.boolean().default(false),
     notifyByEmail: z.boolean().default(true),
     expiresInDays: z.number().int().min(1).max(365).default(90),
   });
   export const addressRequestSchema = z.object({
     id, label, multi, status: z.enum(["open", "fulfilled", "revoked", "expired"]),
     notifyByEmail, responses, url: z.string().url(), expiresAt, createdAt,
   });
   /** What the responder is shown. Nothing about the requester but a first name. */
   export const addressRequestPublicSchema = z.object({
     requesterName: z.string(), label: z.string().nullable(), multi: z.boolean(),
     status: z.enum(["open", "fulfilled", "revoked", "expired"]),
   });
   export const addressRequestResponseSchema = addressInputSchema.pick({ name, line1, line2, city, state, postalCode, country });
   ```

   `requesterName` is the first word of `customers.name`. `label` is
   shown to the responder only for collector links (it is "Holiday card
   2026", which is context), never for single ones (it is the responder's
   own name as the requester typed it, which is odd to be greeted with).

3. **Routes.** On `meRouter` (`server/routes/account.ts`), so
   `requireCustomer` + CSRF + `writeRateLimit` already apply:

   ```
   GET    /api/account/address-requests           → AddressRequest[]
   POST   /api/account/address-requests           → 201 AddressRequest   (needs customers.name; else 409 "Add your name first")
   POST   /api/account/address-requests/:id/renew → AddressRequest      (new expiry, same token)
   DELETE /api/account/address-requests/:id       → 204                 (status → revoked)
   ```

   Public, on a new `addressRequestsRouter` mounted at `/api/address-requests`
   with `verifyCsrf` and a limiter of its own (`requestRateLimit`, 30 per
   hour per IP — a responder submits once):

   ```
   GET  /api/address-requests/:token   → AddressRequestPublic | 404
   POST /api/address-requests/:token   → 204 | 404 | 410 (fulfilled / revoked / expired)
   ```

   The POST validates with `recipientSchema`, runs brief 02B's
   `verifyRecipient` server-side (an `undeliverable` answers 400 with the
   same sentence the form shows; `unknown` passes), inserts into
   `customer_addresses` with `source: "request"`, `requestId`, `verifiedAt`
   when deliverable, `label` = the request's label for single links;
   increments `responses`; for a single link sets `status: "fulfilled"`;
   caps a collector at 200 responses. Then, if `notifyByEmail`, sends
   `AddressReceived` to the requester via `sendEmail` — a new template
   under `emails/` following `VerifyEmail`'s structure: "{name} sent you
   their address. It's in your recipients."

   A token lookup that misses answers 404 with no timing difference worth
   engineering: tokens are 256-bit random.

4. **The public page**, `/address/:token` in `src/router.tsx`, eager (no
   account chunk — the responder is not a customer). `PageWrapper`
   `width="narrow"`. Copy:

   > **Rachel would like to send you a postcard.**
   > Where should it go? Only Rachel will see this, and it's used to
   > address a postcard and nothing else.

   Then `RecipientFields` (brief 02B, with the country select from 02C when
   it exists) and a **Send my address** button. After: "Thanks — Rachel has
   your address." with no further links; the page is done. Fulfilled: "This
   link has already been used. If that wasn't you, ask Rachel for a new
   one." Revoked/expired: "This link is no longer active." Metadata title
   "Share your address" — `server/seo.ts` should not unfurl the requester's
   name into link previews.

5. **The account UI.** On `AccountAddressesPage`, above the list, a short
   panel: **Ask someone for their address** → a `Modal` with label, the
   single/collector switch (labelled "One person" / "Many people, one
   link"), the notify checkbox, and on create the link in an `Input` with
   a **Copy** button (and `navigator.share` when available, with the text
   "Could you send me your mailing address? {url}"). Below it, **Open
   links**: label, one-person/collector, responses, expires, and Copy /
   Renew / Revoke. Entries that arrived via a link carry a small "via your
   link" chip for a week.

   A new `AccountNav` entry is not needed; this lives with the recipients.

### Acceptance (B)

- A signed-in customer creates a single link, opens it in a private window,
  submits an address, and sees it in their recipients with the "via your
  link" chip; the second submission on that link answers 410.
- A collector link takes three responses and stays open.
- A revoked link answers 410 on GET and POST; an expired one likewise.
- The responder page renders with no account chunk in the network log.
- `notifyByEmail` off sends nothing; on, sends one email to the requester.
- A customer with no name is told to add one before a link is created.

## Tests to add

- `db/dialect.test.ts`: new columns and table on both engines;
  `saveRecipientsFromOrder` updates `lastSentAt` on a match.
- `server/security.test.ts`: the four owner routes require a customer
  session; an admin session gets 401 on them; the public POST is
  rate-limited.
- `server/address-requests.test.ts` (new): single-use, collector cap,
  revoke, expiry, verification refusal, the email fires only when opted in.
- Component tests: tag filtering on the account page; the picker's "Select
  all shown".
- e2e: the whole B flow across two browser contexts.

## Out of scope

- Importing contacts from Google or a phone. The CSV path covers "I have a
  list".
- Letting the responder pick which of several addresses to give, or edit
  it later. One submission, one address.
- Reminders to people who have not responded. The requester nudges them.
- Sharing a book between customers.
