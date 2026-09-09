# 🎷🐋 Beluga

### Build your own ecommerce site.

Beluga is open-source software for creating your own ecommerce site, built with React and Node.js, using [Stripe](https://stripe.com/) for payment processing.

---

## ⚠️ v2 is being rewritten — this branch does not sell anything yet

Beluga v1 stopped working because Stripe removed the APIs it was built on. The catalogue used the **SKUs API** and checkout used the **Orders API**; both are gone, and Orders has no server-side replacement, so order state has to live in a database that Beluga did not previously have.

Rather than patch it, v2 rebuilds the stack. Work lands in reviewable phases:

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Vite + React 19 + TypeScript, antd, new storefront | ✅ Done |
| 2 | Database (SQLite/Postgres), API server, security | ✅ Done |
| 3 | Stripe Checkout Sessions, webhooks, orders, email | ✅ Done |
| 4 | Storefront polish, carousel, accessibility | ✅ Done |
| 5 | Setup wizard, admin, product editor | ✅ Done |

**What works today:** first-run setup, the admin (products, collections, orders, settings), browsing, variants, cart, checkout through Stripe, order recording, inventory, and order emails.

**What's outstanding:** nothing in phases 1–5. v1's code stays in [`legacy/`](legacy/) as a reference; nothing builds from it.

Phase 4 closed with an accessibility gate rather than the Lighthouse score it
originally promised. `e2e/accessibility.spec.ts` runs axe against every public
route — and against a filled cart, the mobile nav drawer and the skip link —
under both Playwright projects, so each one is checked at desktop width and
again on a phone. `src/lib/theme.test.ts` covers the part no browser in CI ever
renders: the dark palette's own contrast, as arithmetic.

That is a deliberate substitution. Lighthouse scores a page out of 100 from a
weighted subset of the same axe rules, so "≥ 95" tolerates a real failure as
long as the rest of the page averages it away — and it is a number nobody can
re-derive six months later. A violation count does not average, it names the
element, and it fails the build.

## Requirements

Node 22 or newer (`.nvmrc` is provided — run `nvm use`). v1's Node 18 is past end of life and cannot run the current build tooling.

## Getting started

```bash
nvm use
npm install
npm run setup       # generates secrets, checks your Stripe key, makes your admin account
npm run dev:all     # storefront on :5173, API on :4000
```

`npm run setup` asks a handful of questions, writes `.env` once, and never touches it
again. If you give it a Stripe secret key it validates the key against Stripe before
storing it, and says plainly whether you handed it a live one. One of the questions is
the store's public address — Stripe returns buyers there after paying and every emailed
link starts with it, so leave the default while developing and set it before you deploy.

Prefer a browser? Skip setup and run `npm run dev:all` — the server starts unconfigured
on purpose, and <http://localhost:5173/setup> walks the same three steps. (v1 threw an
uncaught `ENOENT` on a missing `config.env` and never bound a port at all.)

Neither route needs a Stripe account or a database server: SQLite is just a file, and a
store without Stripe still browses, it just cannot take money.

For containers and CI, where no one is at a terminal:

```bash
SESSION_SECRET=$(openssl rand -base64 32) \
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long passphrase' \
npm run db:seed
```

If you deploy first and set up through the browser afterwards, note that
`/setup` is public until the store has an administrator. In production the
server prints a **setup token** at boot and the wizard asks for it, so only
someone who can read the server log can claim a fresh deploy. Set
`SETUP_TOKEN` yourself if the log is awkward to reach.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run setup` | Interactive first-run setup |
| `npm run dev:all` | Storefront and API together |
| `npm run dev` | Storefront only (Vite) |
| `npm run dev:server` | API only |
| `npm run build` | Typecheck, then compile the server to `dist-server/` and build the client to `dist/` |
| `npm start` | Run the compiled server (`node`, no TypeScript at runtime) |
| `npm run typecheck` | Types only |
| `npm run lint` | ESLint |
| `npm test` | Unit and component tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright) |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Migrate, then load the demo catalogue |
| `npm run db:generate` | Regenerate migrations after a schema change |

## Architecture

```
src/       React 19 storefront (Vite)
src/admin/ Admin and setup wizard, loaded on demand
server/    Express 5 API (TypeScript)
scripts/   The `npm run setup` CLI
db/        Drizzle schema, migrations, repository, seed
shared/    zod schemas + helpers, imported by both sides
e2e/       Playwright specs
legacy/    v1 code, kept for reference — not built
```

Two things live on disk and must persist across a redeploy: the SQLite file
under `data/` and uploaded imagery, which is written to `ASSETS_DIR`
(`public/assets` by default). On a platform with an ephemeral filesystem, mount
a volume and point both there.

`shared/schema.ts` is the contract between the storefront and its data, validated on both sides of the wire. Swapping Phase 1's fixture for the Phase 2 database changed exactly one client file, `src/lib/store-source.ts` — set `VITE_BELUGA_API=false` to render the fixture again without a database.

### The admin

`/admin` is a second application, loaded only when someone goes there — a shopper
downloads none of it. Sign in with the account setup created.

Two decisions are worth knowing about, because both are corrections of v1:

- **Products are edited on one autosaving form**, not a four-step wizard. Each step of
  v1's wizard wrote to Stripe immediately, so abandoning it halfway left orphaned
  Products in a live Stripe account, and changing one price meant clicking through four
  screens. Here the draft is local, it saves itself to Beluga's own database, and
  **Publish** is the only thing that ever writes to Stripe.
- **Nothing is deleted on a guess.** v1's delete ran `splice(findIndex(...), 1)` with no
  check, so a miss returned `-1` and `splice(-1, 1)` silently removed the *last* product
  instead of the intended one. Deletes now go by id, the API refuses an unknown one, and
  the dialog names what is about to go.

**The landing page's opening block is edited under Settings → Landing page**: a heading,
a line of text, a button label and target, and an optional background image. Leave any of
them empty and the storefront falls back to what it showed before — the store name, no
paragraph, and a **Shop everything** button pointing at `/shop`. The button's target is
held to a same-origin path or an `https://` address on both sides of the wire, so it
cannot be made to point at `javascript:`. Collections get an introduction of their own on
the **Collections** page, written in Markdown and rendered through the same sanitiser as
store pages; it appears under the collection's heading and becomes its search-result
description.

Display order, in the products list and inside a collection, is edited with buttons
rather than drag-and-drop: it is real persisted data, and it should be editable from a
phone or a keyboard. v1 used `react-drag-sortable`, which is unmaintained, mouse-only,
and incompatible with React 19.

### Theme, typeface and language

**Settings → Look** sets the palette, the corner radius, the logo and the font. A font
stack alone only renders on a machine that already has the face installed, so there is a
second field beside it — **Font stylesheet URL** — holding the stylesheet that defines
the faces: for Google Fonts, the `href` out of the `<link>` they give you; for a
self-hosted face, a stylesheet under `/assets/`. Leave it empty for a system font.

That field exists because the store's Content-Security-Policy allows stylesheets and
fonts from `'self'` only, so before it a Google Fonts `<link>` added by hand was refused
by the browser with nothing on screen to say why. Saving a URL widens the policy by
exactly the origins that stylesheet needs and no others — Beluga fetches the sheet once
and reads them out of it, which is how `fonts.gstatic.com` gets allowed even though it
appears nowhere in the URL you pasted. A URL that cannot be fetched is refused at save
rather than becoming a font that silently never loads, and clearing the field puts the
header back exactly as it was. One consequence worth knowing: the preview in Settings
cannot show a typeface you have not saved yet, because the policy naming it is the one
the store is currently serving.

**Settings → Identity → Language** is the store's BCP 47 tag, and it decides how money,
dates and country names are written everywhere — the storefront, the admin, and order
email. It defaults to `en-US`, which is how every store formatted before the field
existed. A euro shop that leaves it there prints `€1,234.56`; set to `de-DE` it prints
`1.234,56 €`. It also sets `<html lang>`, so screen readers and translation prompts get
the right answer. Prices are stored as integer cents regardless, and the CSV exports are
unaffected.

### Staff accounts

The admin was a single shared account until now — one password for a two-person shop, and no way to revoke access when someone left. **Staff** in the admin lists everyone who can sign in, invites colleagues, and removes them.

Access is granted by a **single-use invitation**. Only a hash of the token is stored, exactly as a password would be, and the raw token exists only in the emailed link; it works once and expires after 72 hours. When SMTP is not configured the link is returned to the inviting admin to pass on, so a self-hosted store without email can still add a colleague.

Removing someone **destroys their sessions immediately** rather than waiting for a cookie to expire, which is most of the point. You cannot remove your own account, and you cannot remove the last owner — a store with no owner has nobody who can add one back.

An administrator who forgets their password can **reset it by email** from `/admin/login`, the same single-use, hour-long token as the customer flow below, on `admin_users` instead of `customers`. A reset destroys every session the account had, exactly like removing someone above. When SMTP is not configured the link is logged rather than sent, so a self-hosted store can still recover an account by reading the API's log.

`role` is recorded but does not gate anything: every administrator can do everything, and the UI says so. Gating it would multiply the permission surface across every route and needs its own security-test matrix, which is a separate decision — the column exists now so that decision is not also a migration.

### Customer accounts

Until now orders were guest-only: retrieved by an unguessable Stripe session id, with no way back for a buyer who lost the confirmation email. `customers` and `customer_addresses` add a second, public-facing login — sign in, register, order history, an address book, password reset — under `/account` on the storefront and `/api/account/*` on the API.

This is a different authentication surface from the admin's, and is held to the same posture: a customer session sets `req.session.customerId`, never `adminId`, so `requireAdmin` refuses it exactly like an anonymous request. `server/security.test.ts` asserts this directly — a signed-in customer gets 401 on every admin route.

**Orders are only ever linked to an account after the email is verified.** Registering creates the account immediately (so a new customer can sign in right away), but claiming past guest orders under that address — and the address book that comes with it — waits for the emailed verification link. Skipping that gate would let anyone register with a stranger's email and read their order history and shipping address; it is the sharpest edge in this feature, and the one place verification cannot be skipped even though nothing else forces it. The same gate applies when a *guest* checkout completes under an email that already belongs to a verified account: the webhook links it there, never to an unverified one.

**Registration, login and a password-reset request all answer identically for a known and an unknown email.** `createCustomer` hashes the password before it discovers the email is taken, so the two branches cost about the same, not just look the same in the response — the same reasoning as the admin login's decoy hash.

Guest checkout stays the default path and nothing in the cart forces an account — the cart page only *offers* signing in, and prefills the shipping country from a signed-in buyer's default address. Reset and verification tokens follow the staff-invite pattern from the section above: only a hash is stored, single-use, and short-lived (an hour for a reset link, a day for verification, since a reset link is a live credential and a verification link is an onboarding step).

### Abandoned cart recovery

**Off by default.** A merchant opts in under Settings, and the reminder goes
out under their own SMTP sending reputation — Beluga sends nothing on its
own until this is turned on.

The cart is client-side identifiers only, so there is nothing server-side to
remind anyone about until a signed-in customer's cart is mirrored to the new
`carts` table (debounced from the browser, only ever for a customer with an
account — a guest's cart never reaches the server before checkout, so there
is no address to contact and nothing worth storing). A customer with nothing
untouched in their cart for the configured delay (default four hours) gets
**exactly one** reminder, with a single-use, 7-day `/cart?recover=<token>`
link that repopulates the cart from the stored identifiers and re-resolves
every line against the live catalogue — dropped, discontinued or unpublished
lines are simply not in the recovered cart, the same way an ordinary cart
already hides them.

A `checkout.session.expired` webhook — a buyer who reached Stripe and did not
pay — is the highest-intent signal available, so it salvages into the same
machinery immediately rather than waiting for the delay. It is behind the same
opt-in as everything else here: Stripe drives this path on its own schedule
rather than the merchant, so on an opted-out store the webhook stores no cart
and sends no mail.

There is no job runner in this project, so the reminder is sent by a
`setInterval` in the API process, the same shape as the session store's prune
timer. What keeps two API instances from sending two emails is not that timer
— each instance runs its own — but a conditional `UPDATE ... WHERE
reminder_sent_at IS NULL` when claiming a cart to remind: only the first of
two racing claims can win, so a duplicate tick costs a wasted query, never a
duplicate email. Every reminder needs a verified, non-suppressed email —
unverified per the same gate as [customer accounts](#customer-accounts), and
suppressed the moment a customer clicks the unsubscribe link every reminder
carries.

### Pages

A store needs prose the catalogue does not hold: a returns policy, shipping
information, contact terms. Consumer-protection rules in several jurisdictions
and Stripe's own account requirements expect a shop to publish them. Until now
there was exactly one page of prose in the whole product — an `aboutText`
column on the settings row — so anything else meant editing React.

**Pages** in the admin writes them. Each has a title, a web address, and a body
in **Markdown**; a page is a draft until it is published, and can optionally be
linked in the storefront menu. Drag-free reordering, as everywhere else.

**Every published page is listed in the storefront footer, in the menu or not.**
The menu flag decides whether a page is also in the header — it does not decide
whether the page can be found. A returns policy left out of the menu is still
one link from every page of the shop, which is the point of publishing it.

Bodies are stored as Markdown and rendered to HTML **on the server, on every
read** — never stored as HTML. Two things follow from that. Tightening the
sanitiser applies retroactively to every page already written, rather than only
to pages saved afterwards. And no Markdown parser reaches a shopper's bundle,
which is why the admin's preview asks the server to render it: a second
implementation in the browser would eventually disagree with the first about
what is safe. The allow-list is prose and nothing else — headings, paragraphs,
lists, links, emphasis, code, quotes, rules. No scripts, no styles, no frames,
no event handlers, and external links carry `rel="nofollow noopener noreferrer"`.

Slugs the storefront already owns — `shop`, `cart`, `confirm`, `product`,
`collection`, `about`, `admin`, `setup` — are refused with a message naming the
conflict, since a page at `/cart` would simply never load.

An existing store's `aboutText` becomes an About page the first time the new
migration runs, once. The column is deprecated and stays for one release so an
install can roll back.

### Images

Uploads are re-encoded by `sharp` — which is what strips EXIF and anything
appended after the image data — and resized copies are written alongside the
original at 400, 800, 1200 and 1600px, skipping any width at or above the
source so nothing is upscaled. The widths that were actually generated are
recorded on the row, so the storefront advertises only files that exist and an
image uploaded before this feature keeps working with a single `src`.

The naming rule (`abc.webp` at 800 is `abc-800.webp`) lives in
[`shared/images.ts`](shared/images.ts) because the server writes those files and
the storefront names them in `srcset`; nothing type-checks that the two agree,
so a drift would be a 404 per image rather than a compile error.

The effect is worth stating plainly: a product thumbnail rendered 70px wide now
downloads 2.3 kB instead of the 17 kB original.

### Shipping

Rates a store configures, matched against destination, parcel weight and order
subtotal — no carrier account, and Stripe's hosted checkout is untouched.
Zones group countries; a zone naming no countries is the catch-all. Rates can be
pinned to a zone and bounded by weight and subtotal, which is how "free over
$50" and "heavy parcels cost more" are expressed. v1 modelled all of this as a
magic Stripe SKU the browser picked.

One consequence worth knowing: **the cart asks which country you are shipping
to.** Hosted Checkout collects the address *after* the session exists, so a
zone-priced store has to know the destination before then. The session is then
restricted to that country, so a buyer cannot keep a domestic rate on an
international address — the same rule as line items, applied to postage.

A store with no rates ships everything free, and nothing at checkout says so —
so the admin Overview warns when a store has live physical products and no
rates, and again when a zone covers a country no rate can price.

Live carrier rates are deliberately absent. They need `ui_mode: 'elements'`,
which means owning the checkout page again; [docs/shipping.md](docs/shipping.md)
has the evidence and the trade.

**Downloads are left out of all of it.** A product is `physical` or `digital`,
and a digital line is excluded from the parcel rather than counted as weighing
nothing — a zero-gram line still participates, so a cart of downloads would
report a 0 g parcel and match the store's lightest weight band. Both the weight
*and* the subtotal a rate is matched against come from the physical lines only:
a $45 download must not push a $10 tote over a "free over $50" threshold, and on
an upper bound it is worse, since it can push a cart past every band, match
nothing, and ship free in silence.

A cart holding only downloads reaches Stripe with no address collection and no
shipping options at all. A mixed cart still collects an address, priced on its
physical lines.

### Products

Every product is `physical` or `digital`, set by the **Type** control in the
product editor. Digital is a modelling flag today: it governs shipping and
stock, but the file itself, the entitlements that grant access to it, and the
download route are not built yet — see
[docs/tasks/13-digital-products.md](docs/tasks/13-digital-products.md).

A digital product's stock is always unlimited, and the API refuses a finite
count on one. That is not tidiness: `decrementInventoryForOrder` would count the
variant down, it would reach zero, and paid orders would start being flagged
`oversold` for a file that cannot run out.

Each variant carries three optional fields beyond price and stock:

- **SKU** — a merchant-set identifier, unique across the catalogue when set.
  It never governs a lookup inside Beluga itself; it exists for a warehouse or
  accounting system to key on, and shows up on order lines, the order CSV, the
  outbound `order.paid` webhook, and in `metadata.sku` on the variant's Stripe
  Price.
- **Compare-at price** — display only, and never sent to Stripe. Set higher
  than the price, it shows struck through beside it with a Sale badge; it is
  never what checkout actually charges.
- **A per-variant image** — an image can be pinned to one variant instead of
  the whole product, so picking a colour shows that colour's picture first.
  Removing the variant it was assigned to does not delete the image; it just
  falls back to the whole product.

### Payments

Checkout uses Stripe **Checkout Sessions** — Stripe's hosted page owns the card fields, 3-D Secure, wallets, and address collection, which keeps this project at PCI SAQ-A.

Three rules the code holds to:

- **Line items are built server-side from stored price ids.** The client sends product and variant identifiers with quantities and never a price, so a tampered cart cannot change what anything costs.
- **The webhook is the only thing that marks an order paid.** The success redirect proves nothing — a buyer can close the tab, and the URL can be visited directly.
- **Webhook delivery is at-least-once**, so events are deduplicated by id. If a handler fails, the dedup record is released so Stripe's retry is actually processed rather than dismissed as a duplicate.

#### Discount codes

Discount codes are created and managed **in the Stripe dashboard**, not in Beluga. Checkout sets `allow_promotion_codes`, so Stripe's hosted page owns the code field and everything behind it: validation, expiry, usage caps, per-customer limits. Beluga records what came off (`discount_cents` on the order) and shows it on the confirmation page, the admin order, and the confirmation email — it does not create, list or edit codes.

That is a deliberate trade. Owning codes in Beluga would mean owning validation, races on usage caps, and Coupon synchronisation; this way the feature is complete and correct on day one. Cart-condition discounts ("10% off orders over $50") are not supported, because computing them Beluga-side would break the rule that prices only ever come from the database.

Stock is returned when an order is refunded in full or cancelled, guarded by a `restocked_at` stamp claimed with a conditional update so several refund webhooks — or a merchant re-saving a cancelled order — cannot inflate the catalogue. A partial refund does not restock: it says nothing about which line came back.

**Refunds follow the same rule as payment.** `POST /api/admin/orders/:id/refund` calls Stripe and stops there; `refunded_cents` and the order's status are written by the `charge.refunded` webhook, which is where the money actually settles. Refunds are additive, so several partial refunds accumulate against one charge, and the order only moves to `refunded` once the whole charge is covered — a partial refund leaves fulfilment alone.

Products reach Stripe only when explicitly published (`POST /api/admin/products/:id/publish`). v1's wizard wrote to Stripe on every step, so abandoning it left orphaned Products behind. Note that Stripe Prices are immutable: changing an amount creates a new Price and archives the old one, which is why historic orders still resolve.

To take a real test payment, put test keys in `.env`, publish a product, and
forward webhooks with the [Stripe CLI](https://stripe.com/docs/stripe-cli):

```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Add the `whsec_…` it prints to `.env` as `STRIPE_WEBHOOK_SECRET`, restart the
API, and pay with test card `4242 4242 4242 4242`. Replaying a delivered event
(`stripe events resend <id>`) must not move stock a second time.

#### Tax

Tax is **off by default** and calculated by **Stripe Tax** when it is on.
Beluga does no tax arithmetic of its own, holds no rate tables, and files
nothing on anyone's behalf.

Three things have to be true in Stripe before a store collects correctly, and
none of them can be done from here:

1. **Stripe Tax is activated** on the account. It is a paid add-on, billed per
   transaction.
2. **Tax registrations are recorded** in the Stripe dashboard, one for each
   place the merchant is obliged to collect. Deciding where that is remains the
   merchant's job — Stripe collects nothing for a jurisdiction with no
   registration.
3. **Products carry tax codes.** Every product uses the store default
   (`txcd_99999999`, Stripe's general tangible-goods code) unless it sets its
   own; books, food, digital goods and clothing are taxed differently in many
   places.

Settings → Tax says all of that before the switch, and the admin overview says
"this store is not collecting tax" while it is off — because under-collecting
is otherwise silent: every order goes through, the buyer pays, and the merchant
owes the difference with nothing anywhere to say so.

**Prices are quoted inclusive or exclusive**, per store. EU and UK shops
normally quote inclusive prices; US shops quote exclusive and add tax at
checkout. Shipping rates carry their own behaviour, because postage is taxable
in some jurisdictions and not others. With inclusive pricing the tax line reads
"Includes tax" rather than adding a row — an additive-looking row on a total
that already contains the tax reads as a second charge.

`tax_behavior` is **immutable on a Stripe Price**, exactly like `unit_amount`.
Changing how a store quotes prices therefore reaches Stripe only when each
product is published again, which mints new Prices and archives the old ones —
historic orders keep resolving against the archived ones. Nothing republishes
itself: writing to a live Stripe account is always something the merchant asks
for, which is the whole point of the publish gate. The overview lists the
products that are out of date and links to each one.

### Storefront search

The shop and collection pages have a search box and a sort control, backed by `searchProducts` / `sortProducts` in `shared/catalog.ts`. Matching is case- and diacritic-insensitive across name, description and bullet points, and every typed term has to match — "blue tote" returns blue totes, not everything blue.

It filters **client-side**, against the catalogue the storefront already loaded from `/api/store`. That is instant, costs no request, and works against the bundled fixture with `VITE_BELUGA_API=false`. When a catalogue outgrows `STORE_SNAPSHOT_LIMIT`, the swap is to `GET /api/products?search=` — which already exists — behind `src/lib/store-source.ts`, the same seam that absorbed the fixture-to-database change.

`?q=` and `?sort=` live in the URL, so a result is shareable, survives a reload, and the back button undoes a search rather than one keystroke.

### Search and link previews

The storefront is client-rendered, so without help a crawler or a link unfurler fetching `/product/anything` would get the generic shell — no product name, no price, no image. Rather than migrating to SSR, the production HTML handler rewrites the `<head>` for the path being requested: title, description, canonical, Open Graph and Twitter tags, and JSON-LD `Product` with an `Offer` on product pages. Only the head is touched; React still boots and renders the body exactly as before.

Per-product overrides live under **Search appearance** in the product editor. Blank means the tag is generated from the name and description. `/sitemap.xml` lists live products and collections, and `/robots.txt` points at it.

This runs only in the production branch, so it is **not visible under `npm run dev`** — Vite serves `index.html` untouched. To check it: `npm run build && npm start`, then `curl -s localhost:4000/product/canvas-tote | grep '<title>'`.

### Exporting orders

`GET /api/admin/orders.csv` streams orders as CSV, one row per order **line** so the file pivots — order-level fields repeat across an order's rows. `?status=`, `?from=` and `?to=` (epoch milliseconds) narrow it; there is a hard cap of 50,000 rows, which is what the date range is for.

Every money column is named `*_cents` and holds an integer, because a column of dollars in a spreadsheet is how floating-point money gets back in. Fields whose first character is `=`, `+`, `-` or `@` are prefixed with an apostrophe: a product named `=HYPERLINK(...)` is a live formula the moment the file opens in Excel, and product names are merchant- and buyer-supplied. The file starts with a UTF-8 BOM so Excel reads accented names correctly.

### Importing and exporting the catalogue

`GET /api/admin/products.csv` writes the whole catalogue, drafts included, **one row per variant** with the product's own fields repeated across its rows — the shape Shopify exports, so the two files can be diffed. The **Export CSV** and **Import CSV** buttons on the Products screen are the same thing with a preview attached.

Columns: `slug`, `name`, `kind`, `description`, `bullet_points`, `seo_title`, `seo_description`, `tax_code`, `option1_name`/`option1_value` through `option3_*`, `variant_sku`, `variant_price_cents`, `variant_compare_at_price_cents`, `variant_inventory_type`, `variant_inventory_quantity`, `variant_weight_grams`, `is_live`, `image_paths`, `variant_image_paths`. Lists inside one cell — bullet points, image paths — are `|`-separated, because the comma is taken. Prices are integer cents, and a decimal in a `*_cents` column is refused by name rather than rounded.

Importing is **two requests, and the split is the feature**:

```
POST /api/admin/products/import/validate  -> { rows, creates, updates, errors[], products[] }
POST /api/admin/products/import/commit    -> { created, updated, skipped }
```

Both take the file as the request body with `Content-Type: text/csv`, parsed as a stream so neither side holds it whole; the caps are 5 MB and 5,000 rows. Validation writes nothing and reports **every** error at once, each with its row and column — a merchant fixing a 500-row file one error per attempt gives up. If anything fails, the whole file is refused unless `?skipInvalid=true`, which the preview offers and defaults to off; skipping is per product, since half a variant matrix is not a product. The commit re-parses and re-validates rather than trusting a token from the preview.

Things worth knowing before importing over a live catalogue:

- **Products are matched by `slug`** — present is an update, absent is a create.
- **A column the file omits leaves the stored value alone.** A three-column price list will not blank every description in the catalogue. A column that is present but empty *does* clear the field, so there is still a way to.
- **A variant keeps its id** when its SKU matches an existing variant's, or — for a variant with no SKU — when its combination of option values still matches, so an update does not orphan the Stripe Price behind it. For the same reason an import will refuse to collapse a product's options by leaving their columns out, rather than deleting the variants that would fall off.
- **An import never writes to Stripe.** Invariant 7 holds here: imported products land as drafts unless `is_live` says otherwise, and even a live one is not published until someone publishes it.
- **Images and non-priced option groups are not managed by the file.** `image_paths` and `variant_image_paths` are written on export and ignored on import; both are edited in the product editor.

### Outbound webhooks

Beluga can POST to your own endpoints when something happens in the store, which is what a merchant would otherwise need an app ecosystem for: wire up a fulfilment provider, an accounting ledger or a Zapier-style connector without either side shipping code into the other's process. Add endpoints under **Admin → Webhooks**.

Six events, matching states the system already knows about:

| Event | When |
| --- | --- |
| `order.paid` | The Stripe webhook confirmed payment |
| `order.updated` | Fulfilment status, carrier or tracking number changed |
| `order.refunded` | A refund settled — compare `refundedCents` to `totalCents` for partial |
| `order.cancelled` | An order was cancelled from the admin |
| `product.published` | A product was published to Stripe |
| `inventory.low` | A sale left a finite variant at five units or fewer |

The body is an envelope — `{ id, type, created, data }` — and the `id` is repeated in a `beluga-event-id` header so you can deduplicate on it. **Delivery is at-least-once**: retried on failure with exponential backoff (1m, 5m, 25m, 2h, 10h, then given up), so build your receiver to tolerate seeing the same event id twice. An endpoint whose deliveries have given up five times running is switched off, and the admin says so; re-enabling it clears the count.

Every request is signed. The `beluga-signature` header is `t=<unix seconds>,v1=<hex>`, where the HMAC-SHA256 is taken over `` `${t}.${rawBody}` `` under that endpoint's secret — the same shape Stripe uses, so if you already verify Stripe's webhooks this is that code with a different header name:

```js
const [t, v1] = req.get("beluga-signature").split(",");
const expected = crypto
  .createHmac("sha256", process.env.BELUGA_WEBHOOK_SECRET)
  .update(`${t.slice(2)}.${rawBody}`)
  .digest("hex");

if (!crypto.timingSafeEqual(Buffer.from(v1.slice(3)), Buffer.from(expected))) {
  return res.status(400).end();
}
```

Verify against the **raw** body, before any JSON parsing, and reject a timestamp older than your own tolerance — the timestamp is inside the signed material precisely so a replay is detectable. Answer any 2xx to accept; anything else gets the retry schedule.

Two things about the secret. It is shown **once**, when the endpoint is created — nothing reads it back, so copy it into your receiver there and then, and roll a new one if you lose it. And rolling invalidates the old one immediately, so expect failed deliveries until the new secret is in place.

Endpoints must be `https://` on a **publicly reachable** host: the URL's hostname is resolved and refused if it lands on a private or reserved address, both at creation and again before every send, redirects included. Without that, an endpoint pointed at `169.254.169.254` would turn admin access into a way to read the host's cloud metadata. `WEBHOOK_ALLOW_INSECURE_TARGETS=true` lifts both restrictions for a self-hoster whose receiver genuinely listens on localhost; leave it off anywhere public.

Nothing is ever sent from a request handler. Events are queued and delivered by a background pass every ten seconds, which is what keeps a slow subscriber from delaying Beluga's response to Stripe — a delay there would trip Stripe's own retry and re-enter the payment handler.

**[`docs/webhooks.md`](docs/webhooks.md) is the guide to building a receiver** — payload examples for every event, verification in Node and Python, the raw-body gotcha, how to test against a local endpoint, and a troubleshooting table.

### Database

SQLite by default, because a store should run without provisioning anything. Point `DATABASE_URL` at Postgres when a catalogue outgrows a single file:

```bash
DATABASE_URL=postgres://user:pass@host:5432/beluga npm run db:migrate
```

The query layer is written once and `db/dialect.test.ts` runs the same assertions against both engines — Postgres included, via `embedded-postgres`, so no system install is needed to verify it.

Three conventions worth knowing before contributing:

- **Money is always integer cents.** v1 stored floats and multiplied by 100, which sent amounts like `1998.9999999999998` to Stripe. See `shared/money.ts`.
- **The cart stores identifiers only** — never prices or image URLs. Everything displayable is derived from the current catalogue, so a price change can't leave stale amounts in someone's open cart.
- **Money is never taken from the request.** Prices, and therefore totals, come from the database on every path.
- **Every mutating route is behind `requireAdmin` and a CSRF check**, applied to the whole admin router rather than per-endpoint, so a new route cannot be added unprotected by accident. `server/security.test.ts` asserts this for each one.

## Secrets

Never commit keys. Copy `.env.example` to `.env` for local development and use platform environment variables in production. The Stripe **secret** key is server-only; only the publishable key is ever sent to the browser.

v1 shipped a `config.env` that the server rewrote at runtime to store the admin password hash, and its `/config`, product, image and upload routes had no authentication at all. v2 stores argon2id hashes in the database, never writes to its own configuration, and gates every write behind a session plus a CSRF token.

---

Beluga is the next iteration of [react-stripe-store](https://github.com/binx/react-stripe-store).

<a href="https://www.buymeacoffee.com/binx" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/lato-blue.png" alt="Buy Me A Coffee" height="51px" width="217px"></a>
