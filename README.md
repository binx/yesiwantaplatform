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
| 4 | Storefront polish, carousel, accessibility | 🟡 Mostly |
| 5 | Setup wizard, admin, product editor | ✅ Done |

**What works today:** first-run setup, the admin (products, collections, orders, settings), browsing, variants, cart, checkout through Stripe, order recording, inventory, and order emails.

**What's outstanding:** Phase 4 still owes the Lighthouse pass that confirms accessibility ≥ 95 — the structural work it measures (real `<img>` with alt text and `srcset`, labelled controls, keyboard-reachable buttons, scroll containers) has landed. v1's code stays in [`legacy/`](legacy/) as a reference; nothing builds from it.

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
storing it, and says plainly whether you handed it a live one.

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

## Scripts

| Command | What it does |
| --- | --- |
| `npm run setup` | Interactive first-run setup |
| `npm run dev:all` | Storefront and API together |
| `npm run dev` | Storefront only (Vite) |
| `npm run dev:server` | API only |
| `npm run build` | Typecheck, then production build |
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

Display order, in the products list and inside a collection, is edited with buttons
rather than drag-and-drop: it is real persisted data, and it should be editable from a
phone or a keyboard. v1 used `react-drag-sortable`, which is unmaintained, mouse-only,
and incompatible with React 19.

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

Live carrier rates are deliberately absent. They need `ui_mode: 'elements'`,
which means owning the checkout page again; [docs/shipping.md](docs/shipping.md)
has the evidence and the trade.

### Payments

Checkout uses Stripe **Checkout Sessions** — Stripe's hosted page owns the card fields, 3-D Secure, wallets, and address collection, which keeps this project at PCI SAQ-A.

Three rules the code holds to:

- **Line items are built server-side from stored price ids.** The client sends product and variant identifiers with quantities and never a price, so a tampered cart cannot change what anything costs.
- **The webhook is the only thing that marks an order paid.** The success redirect proves nothing — a buyer can close the tab, and the URL can be visited directly.
- **Webhook delivery is at-least-once**, so events are deduplicated by id. If a handler fails, the dedup record is released so Stripe's retry is actually processed rather than dismissed as a duplicate.

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
