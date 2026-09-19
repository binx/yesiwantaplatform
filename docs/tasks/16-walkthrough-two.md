---
task: "16"
title: "Second walkthrough: show the product, one noun, fewer knobs"
status: todo
tier: 1
size: L
migration: drop four columns on customer_addresses (part I only)
blocked_by: []
blocks: []
touches: src/pages/LandingPage.tsx · src/pages/CreatePage.tsx · src/components/postcard/Schedule.tsx · src/components/postcard/DesignForm.tsx · src/pages/CartPage.tsx · src/components/layout/Banner.tsx · src/router.tsx · src/pages/account/AccountPostcardsPage.tsx · src/pages/account/AccountAddressesPage.tsx · shared/account.ts · shared/cart.ts · db/schema.sqlite.ts · db/schema.pg.ts
completed:
shipped_in:
summary: >-
  Nine cuts and one addition from a second customer walkthrough on 2026-09-19.
  The landing page gains a two-up section that shows the back of the card and
  the scheduler, the storefront settles on "postcard" as its one noun, the
  QR always prints, the cart loses a line of copy, the header icon gets a
  tooltip, the dead /about route goes, "send again" moves onto the gallery
  card, and the address book shrinks to name and address. Parts are
  independent PRs; I is the only one with a migration.
---

# 16 · Second walkthrough: show the product, one noun, fewer knobs

Written 2026-09-19 after a second pass through the storefront as a new and a
returning customer. Nothing here is a bug. Every part is either a cut or a
piece of copy, except A, which adds a section, and H, which moves a button.

Nine parts, **A–I**. Each is its own PR and stands alone; land them in any
order. Suggested: **C** first (every other part's copy is written in its
vocabulary), then the small ones (**B, D, E, F, G**) in one afternoon, then
**H**, **A** and **I**.

Read `docs/tasks/README.md` first. The conventions that matter most here:
the two faces of the card change together (part D), validation lives in
`shared/` (parts D, I), and a schema change lands in both dialects (part I).

---

## Part C · One noun: "postcard"

Land this first. The storefront currently uses four words for the thing
the customer makes: *design*, *card*, *postcard*, *batch*. "Design" is our
word (it is the table name), not the customer's. From here on the customer
makes **postcards**, and a cart line is a **set** of them when it has to be
named at all.

### Rules

- The thing saved from the designer is a **postcard**. Never "design" in
  copy, headings, buttons, `aria-label`s or alert titles.
- A cart line is **these postcards** where the sentence allows it, and a
  **set** where a noun is unavoidable (an `aria-label` that needs an index).
  "Batch" disappears from customer-facing copy.
- **Do not rename code.** `PostcardDesign`, `designs`, `designId`,
  `/api/designs`, the `?designs=` query parameter, `design-heading`, CSS
  class names and comments all stay. This is copy only.

### Every string, old → new

`src/pages/CreatePage.tsx`

| Old | New |
|---|---|
| `1. Create a postcard design` | `1. Design your postcard` |
| `All {n} designs go to each person below.` | `All {n} postcards go to each person below.` |
| `{n} design` / `designs` in the total line | `{n} postcard` / `postcards` |
| `Save at least one design and add at least one recipient.` | `Save at least one postcard and add at least one recipient.` |
| `…need checking before this batch can go in the cart.` | `…need checking before these postcards can go in the cart.` |
| `{count} postcards in this batch. You can add another batch from the cart.` | removed — see part B |

`src/components/postcard/DesignForm.tsx`

| Old | New |
|---|---|
| `Save this design` | `Save this postcard` |
| `That design could not be saved` (both alerts) | `That postcard could not be saved` |
| `To change the photo, remove this design and save a new one.` | `To change the photo, remove this postcard and save a new one.` |
| `The saved photo for this design` (aria-label) | `The saved photo for this postcard` |

`src/components/postcard/Schedule.tsx`

| Old | New |
|---|---|
| `No saved designs yet.` | `No saved postcards yet.` |
| `Mail date for design {n}` | `Mail date for postcard {n}` |
| `Edit design {n}` / `Remove design {n}` | `Edit postcard {n}` / `Remove postcard {n}` |
| `Which design` (aria-label on the "ahead of a date" select) | `Which postcard` |
| `Design {n}` (the options in that select) | `Postcard {n}` |

`src/components/postcard/Recipients.tsx`

| Old | New |
|---|---|
| `…Fix or remove them before adding this batch to the cart.` | `…Fix or remove them before adding these postcards to the cart.` |

`src/pages/CartPage.tsx`

| Old | New |
|---|---|
| `{n} design(s) to {m} recipient(s)` | `{n} postcard(s) to {m} recipient(s)` |
| `{n} design(s) back to {name}` | `{n} postcard(s) back to {name}` |
| `A design in your cart is no longer available. Remove that batch and make it again.` | `A postcard in your cart is no longer available. Remove it and make it again.` |
| `{n} designs in your cart are no longer available. Remove those batches and make them again.` | `{n} postcards in your cart are no longer available. Remove them and make them again.` |
| `Remove batch {n} from cart` (aria-label) | `Remove set {n} from cart` |
| `Create another batch` | `Make another postcard` |

`src/components/postcard/PostcardSchedule.tsx`

| Old | New |
|---|---|
| `<th>Design</th>` | `<th>Postcard</th>` |

`src/pages/account/AccountPostcardDetailPage.tsx`

| Old | New |
|---|---|
| `This design doesn't exist, or isn't on your account.` | `This postcard doesn't exist, or isn't on your account.` |
| `Could not copy the design.` | `Could not copy the postcard.` |

Grep for anything missed before opening the PR:

```bash
grep -rnE '\b([Dd]esigns?|[Bb]atch(es)?)\b' src/pages src/components --include='*.tsx' | grep -vE 'test|import|PostcardDesign|designId|designs\.|\.designs|useDesigns|setDesigns|design-heading|DesignForm|DesignCard|//|\*'
```

What remains should be identifiers, not sentences.

### Tests to update

Every test that finds an element by one of the old strings:

- `src/components/postcard/Schedule.test.tsx` — `Mail date for design N`,
  `Edit design N`.
- `src/components/postcard/DesignForm.test.tsx` — `Save this design`,
  `To change the photo, remove this design and save a new one.`
- `e2e/storefront.spec.ts` — `Save this design` (in `designOne` and two
  other places), `Remove design 1`, `Remove design 2`, `Edit design 1`,
  `Mail date for design 2`, `1 design to 1 recipient`, `2 designs to 1
  recipient`, `/Remove batch 1/`, and the edit-mode sentence.
- `src/pages/account/AccountPostcardsPage.test.tsx` — the test titles
  mention "design" and "batch"; the assertions do not. Leave them or rename
  them, either is fine.

### Out of scope

The admin (`src/admin/`) keeps "design": it is a back-office and the table
is called `postcard_designs`. Emails in `emails/` were not audited here;
grep them too and fix any that say "design" to a customer, but do not
restructure them.

---

## Part B · The batch model, explained once

Commit `88caf99` removed the create page's intro paragraph. With it gone,
the model "every postcard goes to every recipient" is still stated twice:
the subhead in section 3 (only when there are two or more postcards) and
the note beside the Add-to-cart button.

Keep the subhead. It appears exactly when the model first matters — the
moment a second postcard exists — and nowhere else. Cut the note.

`src/pages/CreatePage.tsx`, the `totalActions` block: the three-way note
becomes two-way. Keep the `count === 0` branch and the `blocked > 0`
branch; delete the final `else` (`{count} postcards in this batch…`). When
the batch is ready to go, the total line above already says what it is, and
the button says what to do.

The cart's `Make another postcard` button (part C) is where a buyer
discovers they can make a second set. That is enough.

No test covers the removed sentence. `npm test` stays green.

---

## Part D · The QR always prints

The reply QR is on by default and almost nobody would turn it off. The
checkbox lives in the schedule section, which is the wrong place for a
back-of-card option anyway. Remove the choice: every card prints the QR.

### Client

- `src/components/postcard/Schedule.tsx`: delete the `replyLink` and
  `onReplyLinkChange` props, the `Checkbox` block inside
  `items.length > 0`, and the `Checkbox` import if nothing else uses it.
  Delete `.replyOption` from `src/components/postcard/Postcard.module.css`.
  The `DELIVERY_ESTIMATE` paragraph stays.
- `src/pages/CreatePage.tsx`: delete the `replyLink` state and every place
  it is passed. `line()` no longer sets `replyLink`.
- `src/components/postcard/DesignForm.tsx`: delete the `replyLink` prop and
  its default.
- `src/components/postcard/PostcardBackMock.tsx`: delete the `replyLink`
  prop and always draw the footprint. The account detail page currently
  renders the mock without the prop and so shows a back with no QR for a
  card that printed one; after this it shows the truth.

### Contract and server

Remove the field rather than leave it defaulted. A field that is always
true is a field that lies about being a choice.

- `shared/cart.ts`: delete `replyLink` from `cartLineSchema`. The schema is
  a plain `z.object`, so a stale line in a shopper's `localStorage` that
  still carries `replyLink` is parsed with the key stripped, not rejected.
  Confirm this by reading `src/store/cart.ts`'s `merge` — it runs persisted
  lines through the schema — and by the existing `src/store/cart.test.ts`
  case, which you will be editing anyway.
- `db/orders-repository.ts:105`: `replyCode: generateReplyCode()`,
  unconditionally.
- `server/cart-recovery.ts:178`: stop reconstructing `replyLink` from the
  postcards when rebuilding a line for a recovery link.

### Tests

- `shared/cart.test.ts:29` — drop `replyLink` from the expected defaults.
- `src/store/cart.test.ts:33` — same.
- `server/cart-recovery.test.ts:70,139` — drop the field from the literals.
- `db/dialect.test.ts:147,243,275,276,427` — drop the field. Line 276 is a
  line with `replyLink: false`; after this every card has a code, so the
  case that checks the mixed batch needs its expectation updated to "all
  cards have a reply code".
- `server/reply.test.ts:134–172` — `sentCard({ replyLink: false })` and the
  test that a card without a link cannot be replied to: delete that test.
  It tested a state that no longer exists.
- `src/components/postcard/Schedule.test.tsx:35` — drop the prop.

### Both faces

`print/back.hbs:56` already prints the QR whenever `replyQr` is set, and
its caption (`Scan to send your own postcard` / `postcardgifts.com`)
matches the mock's as of `d960e0f`. Nothing to change in the template.
Confirm they still agree before merging; that is the README's rule.

### What this does not change

Whether a scanned QR can actually *send one back* still depends on the
sender having an account with Replies turned on
(`server/routes/reply.ts:59`). A guest's card links to the reply page,
which shows the card and the "Send one to someone" link. That is fine, and
out of scope here.

---

## Part E · Cut the discount line

`src/pages/CartPage.tsx`: delete

```tsx
<p className={styles.note}>Discount codes can be entered at checkout.</p>
```

Stripe still honours a promotion code on the checkout page, and
`README.md:181` still says so for the merchant. The shopper does not need
to be told. `.note` in `CartPage.module.css` is still used by the sign-in
paragraph; leave it.

---

## Part F · A tooltip on the account icon

`src/components/layout/Banner.tsx`: the account link is a bare
`UserOutlined` with the label only in `aria-label`. Wrap it in antd's
`Tooltip` with `title={accountLabel}` — the same string, `Sign in` or
`Your account`, that the drawer shows. Do the cart link the same way with
`title="Cart"` so the two icons behave alike.

`Tooltip` takes a single child that forwards mouse events; react-router's
`Link` renders an `<a>` and works as-is. Keep the `aria-label`s; the
tooltip is for pointers, the label is for readers.

No test exists for `Banner`. Check it by hand in the preview; the tooltip
should not appear on the phone layout's drawer links (it is not applied
there).

---

## Part G · Remove the `/about` route

There is no about page. `src/router.tsx:129` special-cases the slug for
nothing, and a visitor who guesses the URL gets the store's 404 through a
route that exists only to produce it. A merchant page with slug `about`
already resolves through the generic `:slug` route below it.

- `src/router.tsx`: delete the `{ path: "about", … }` entry.
- `src/pages/PagePage.tsx`: delete the `slug` prop, its interface, its
  comment, and the `override ?? …` — `params.slug` is the only source now.
- `server/seo.ts:109`: `const slug = decodeURIComponent(path.slice(1));`.
  The ternary existed only for the special route.

No test references `/about`. `server/seo.test.ts` may have a case for a
merchant page by slug; it should still pass unchanged.

---

## Part H · "Send again" on the gallery card

The returning customer's main job is "send that one again to these
people." Today the gallery card (`DesignCard` in
`src/pages/account/AccountPostcardsPage.tsx`) is one big `Link` to the
detail page, and the detail page has the button. Put the button on the
card.

### What to build

`DesignCard` becomes a card with two parts: the existing `Link` (thumb,
excerpt, summary) and, below it, an actions row that is *not* inside the
link — a button inside an anchor is invalid HTML and a keyboard trap.

```tsx
<li className={styles.card}>
  <Link to={`/account/postcards/${design.id}`} className={styles.cardLink}>
    …thumb, excerpt, summary as today…
  </Link>
  <div className={styles.cardActions}>
    {design.canSendAgain ? (
      <Button size="small" loading={…} onClick={…}>Send again</Button>
    ) : null}
  </div>
</li>
```

`galleryDesignSchema` already carries `canSendAgain` (`shared/gallery.ts:27`),
so the list has what it needs without a new field. The handler is the one
the detail page uses: `useDuplicateDesign().mutate(design.id, { onSuccess:
(copy) => navigate(`/create?designs=${copy.id}`) })`, with the same
`message.error` on failure. Lift it into a small `SendAgainButton`
component in the same file so the detail page and the card share it.

`DesignCard` is rendered by the gallery grid and by the overview page's
"Your latest postcards" (`AccountOverviewPage.tsx`), so both get the
button for free. The `<li>` wrapper: check which of the two callers
currently owns the `<li>` and keep the DOM valid in both.

Styling: `.cardActions` in `src/pages/account/Gallery.module.css`, a
right-aligned row under the summary with `margin-top: 0.5rem`. The
`loading` state on the button is enough feedback; no toast on success
because the navigation is the feedback.

Keep the button on the detail page too. It costs nothing and the detail
page is where "Sent again" history lives.

### Test

`src/pages/account/AccountPostcardsPage.test.tsx`: add a case that renders
a card with `canSendAgain: true`, clicks Send again, and asserts a POST to
`/api/account/designs/d1/duplicate` followed by navigation to
`/create?designs=<returned id>`. The existing tests in that file show how
the fetch mock and the router are set up. Add the inverse: with
`canSendAgain: false` there is no button.

### Out of scope

Choosing several cards and sending them together in one trip
(`?designs=a,b` already works on the create page). Worth a follow-up brief
if the single-card button gets used.

---

## Part A · The landing page shows the product

The hero shows a hand holding cards. A first-time visitor never sees the
back of a card — the note, the handwriting, the QR — or how the scheduler
works, until they are inside the designer. Add one short section, two
items side by side on desktop, stacked on a phone, directly under the hero
and above the Information / Inspiration columns. It replaces `table.jpg`.

### Layout

`src/pages/LandingPage.tsx`, a new `<section className={styles.show}>`
inside the `PageWrapper`, before `.columns`. Two `<article>`s in a grid:

```css
.show {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(24rem, 100%), 1fr));
  gap: 2.5rem;
  margin: 2.5rem 0 1rem;
}
.show article { display: grid; gap: 1rem; align-content: start; }
.show h2 { font-size: 1.25rem; margin: 0; }
.show p { margin: 0; color: var(--beluga-muted); }
```

Not the `.script` heading style — those are for the two big columns below;
this section should read as part of the page, not a third chapter. Plain
headings at the site's `h2` size.

Delete the `<img className={styles.table} …>` and `.table` from the CSS.
Delete `public/table.jpg` — nothing else references it (grep first).

### Left: the back of the card

Heading: **Your photo on the front. Your words on the back.**

Body, one paragraph: *Write a note, pick a handwriting, and it prints on
the back with the address. A small QR code lets them see the card online.*

Below it, the real back-of-card mock: `PostcardBackMock` from
`src/components/postcard/PostcardBackMock.tsx`, with a fixed sample:

```ts
const SAMPLE_BACK: PostcardBack = {
  ...defaultPostcardBack,
  text: "Made it to the desert! Forty-one cactuses counted so far and the light at six is unreal. Wish you were here for the pie.",
  valediction: "Love, R.",
  fontName: "Patrick Hand",
  fontSize: 20,
};
```

Use `defaultPostcardBack` from `@shared/postcards` for the ink colour and
anything else, so the sample never drifts from what the designer starts
with. The mock is `aria-hidden` and needs no `onFit`.

**Width.** As of the current tree the mock draws at a fixed 468px and no
longer scales itself. The designer's `.backRow` column is sized for it; a
phone column is not. Wrap it in a container that scales it down with a
transform when the column is narrower than 468px — the same approach the
mock itself used before it was simplified (a `ResizeObserver` on the
wrapper, `scale = min(1, width / 468)`, wrapper `aspect-ratio` fixed so
the layout keeps the card's shape). Put that wrapper in `LandingPage.tsx`
as a local component; if the designer needs the same thing on a phone, the
wrapper can move to `PostcardBackMock` later. Do not reintroduce the
scaling into the mock in this PR.

### Right: the schedule

Heading: **You pick the days.**

Body, one paragraph: *Send them all at once, or spread them out — one a
week, one a month, whatever you like. Sending a birthday card? Tell us the
day and we'll mail it early enough to land.*

Below it, a small static mock of the schedule as the designer shows it:
three thumbnails in a row with a date under each. Code, not a screenshot.

```tsx
<ol className={styles.scheduleMock} aria-hidden>
  {[["Mon, Oct 5", "#ff00ff"], ["Mon, Oct 12", "#00ffff"], ["Mon, Oct 19", "#ffff37"]].map(([date, tint]) => (
    <li key={date}>
      <span className={styles.scheduleThumb} style={{ background: tint }} />
      <span>{date}</span>
    </li>
  ))}
</ol>
```

The three tints are v1's CMYK plates the page already uses for the hero
bullets — the same `#ff00ff`, `#00ffff`, `#ffff37` in `LandingPage.module.css`.
Each `scheduleThumb` is a portrait rectangle (`aspect-ratio: 2 / 3`, `width:
4.5rem`, `border-radius: var(--beluga-radius)`, `opacity: 0.35`). Between
the first and second, and the second and third, a short muted `+ 7 days`
in the site's small type. The dates are fixed strings, not computed from
today; they are an illustration and a test can look for them.

If a real sample front exists by the time this lands (a photo you own,
sized like the hero image), use three crops of it in place of the tints —
but do not block on that.

### Copy

Both headings and both paragraphs are hard-coded, not settings. The hero
already has its editable heading, text, button and image; this section is
the product's explanation and is not something the merchant should have to
write. If that changes, it is a settings brief, not this one.

### Test

`src/pages/LandingPage.test.tsx`: add one case that the section renders
both headings, the sample note's first sentence, and the three dates.
`PostcardBackMock` is `aria-hidden`, so query the note with `getByText`
(which does not filter hidden content), not `getByRole`.

### Check by hand

Desktop: two columns of equal width, the card mock at full size on the
left, the three thumbnails on the right, and the section sits between the
hero and the dotted rule that opens the Information column. Phone: stacked,
the card scaled to the column, nothing scrolling sideways.

---

## Part I · The address book is a list of addresses

The account area has more surface than the product. Cut the address book
back to what the designer uses: **a name and an address**, plus the
ask-for-address links, which stay. Everything that made it a "book" goes:
label, tags, birthday, notes, the "last sent" line, tag filtering, and the
CSV export.

The one migration in this brief. Both dialects, both migration folders.

### Schema and contract

`db/schema.sqlite.ts` and `db/schema.pg.ts`, table `customer_addresses`:
drop `label`, `tags`, `birthday`, `notes`. Keep `last_sent_at` — it is
written by the order path and costs nothing, and it is what a future
"most recent first" sort would use. It is no longer *shown* anywhere.

```bash
npm run db:generate
```

Commit the new folder under both `db/migrations/sqlite` and
`db/migrations/pg`. SQLite's `DROP COLUMN` is what drizzle-kit emits;
the bundled SQLite in `better-sqlite3` supports it.

`shared/account.ts`: delete `addressBookFields`. `addressInputSchema`
becomes `recipientFieldsSchema.superRefine(refineRecipient).transform(normaliseRecipient)`
— which is the recipient input schema, so alias it rather than repeat it
if `shared/postcards.ts` already exports that shape. `customerAddressSchema`
keeps `id`, `verifiedAt`, `source`, `lastSentAt`.

`db/customers-repository.ts`: `AddressWrite` collapses to `Recipient`.
Remove the four fields from `buildAddress`, `createAddress`, `updateAddress`
and the `AddressRow` type. In `saveRecipientsFromOrder`, delete the label
carry-over from a namesake (`label: recipient.label ?? namesake?.label`);
the namesake lookup itself decides whether this is an update or a new row
and stays.

`db/address-requests-repository.ts` `recordAddressResponse`: the single
link's label used to become the new entry's label. There is no label now;
save the recipient as typed. The request keeps its own `label` — that is
what the requester called the link, and it is displayed on the requests
list, not on the address.

### Server

`server/routes/account.ts:302–334`: the four address routes parse with
`addressInputSchema` and need no change beyond the schema. Verify the
`PUT` still round-trips a plain recipient.

### Client

`src/lib/address-book.ts`: delete `allTags`, `formatBirthday`,
`addressBookCsv` and `addressTitle`. `filterAddresses(addresses, query)`
loses its `tags` argument and matches on `name`, `city` and `line1` only.
The file shrinks to that one function and the `formatRecipient` re-export;
consider folding it into `src/lib/account.ts`.

`src/pages/account/AccountAddressesPage.tsx`:

- The edit form loses the Label, Tags, Birthday (and its "I know the year"
  toggle) and Notes fields. What is left is `RecipientFields` and the
  verification notice — the same form the designer shows.
- The list header loses the tag filter row and the **Export CSV** button.
  Keep the search box; a list of sixty people still needs one. Its
  placeholder becomes `Search by name or city`.
- Each row shows the name and the formatted address. Delete the `facts`
  line ("Last sent …", "Birthday …"), the tag chips and the notes line.
- The page's doc comment describes a book; rewrite it for a list.

`src/components/postcard/Recipients.tsx`, the **Saved recipients** modal:
delete the tag filter, the "Last sent" line under each entry, and the
`addressTitle` call (show `address.name`). The search and "Select all
shown" stay.

`src/pages/account/AccountOverviewPage.tsx` renders none of the removed
fields; check and move on.

### Tests

- `db/dialect.test.ts:301–330` — "keeps the address book's label, tags,
  birthday and notes" is deleted. Replace with a create → list → update →
  list round-trip of a plain recipient, on both engines, so the table still
  has a dialect test.
- `server/recipients.test.ts:206–213` — the POST that sends the four fields
  and the birthday-format rejection: delete the rejection, and change the
  create case to assert the plain recipient comes back with `source:
  "manual"` and no extra keys.
- `src/lib/address-book.test.ts` — keep "finds people by name or city";
  delete the tag, birthday, title and CSV cases.
- `db/dialect.test.ts:344–360` (address requests) — the assertion
  `toMatchObject({ label: "Maya", … })` on the *saved address* goes; assert
  on `source: "request"` and `name`.
- `server/security.test.ts` — no route changes; it should pass untouched.
- E2E: `e2e/storefront.spec.ts` does not touch the address book. If an
  `e2e/admin` spec seeds addresses with tags, fix the seed.

### README

`README.md:143–145`: the address book paragraph. Rewrite to: *the people a
customer has sent to are saved when an order is paid, and the designer
offers them back as a picker. A customer can also send someone a link to
type in their own address.*

### Out of scope

The ask-for-address links (`AddressRequests.tsx`, its routes and table)
stay exactly as they are. Sorting the list by `lastSentAt` is not asked
for; the alphabetical order stays.

---

## Definition of done, for every part

- `npm run typecheck && npm run lint && npm test` pass.
- `npm run test:e2e` passes after part C (it is the part that breaks it).
- Part I: both migration folders committed, `db/dialect.test.ts` green on
  both engines.
- Part D: both faces of the card agree — the mock and `print/back.hbs`.
- This file's frontmatter updated as `docs/tasks/README.md` describes.
