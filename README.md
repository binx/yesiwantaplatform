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
| 4 | Storefront polish, carousel, accessibility | ⬜ Next |
| 5 | Setup wizard, admin, product editor | ⬜ |

**What works today:** browsing, variants, cart, checkout through Stripe, order recording, inventory, and order emails — all served from a real database through an authenticated API.
**What doesn't:** there is no admin UI yet, so products are published and orders managed over the API. v1's code is parked in [`legacy/`](legacy/) until Phase 5 replaces it.

## Requirements

Node 22 or newer (`.nvmrc` is provided — run `nvm use`). v1's Node 18 is past end of life and cannot run the current build tooling.

## Getting started

```bash
nvm use
npm install
npm run db:seed     # creates data/beluga.sqlite and loads the demo catalogue
npm run dev:all     # storefront on :5173, API on :4000
```

No Stripe account, database server, or configuration file is required. SQLite is a file, and the server starts even when nothing is configured — it reports that state over the API and the storefront shows what to run next. (v1 threw an uncaught `ENOENT` on a missing `config.env` and never bound a port.)

To add an admin account:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long passphrase' npm run db:seed
```

## Scripts

| Command | What it does |
| --- | --- |
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
server/    Express 5 API (TypeScript)
db/        Drizzle schema, migrations, repository, seed
shared/    zod schemas + helpers, imported by both sides
e2e/       Playwright specs
legacy/    v1 code, kept for reference — not built
```

`shared/schema.ts` is the contract between the storefront and its data, validated on both sides of the wire. Swapping Phase 1's fixture for the Phase 2 database changed exactly one client file, `src/lib/store-source.ts` — set `VITE_BELUGA_API=false` to render the fixture again without a database.

### Payments

Checkout uses Stripe **Checkout Sessions** — Stripe's hosted page owns the card fields, 3-D Secure, wallets, and address collection, which keeps this project at PCI SAQ-A.

Three rules the code holds to:

- **Line items are built server-side from stored price ids.** The client sends product and variant identifiers with quantities and never a price, so a tampered cart cannot change what anything costs.
- **The webhook is the only thing that marks an order paid.** The success redirect proves nothing — a buyer can close the tab, and the URL can be visited directly.
- **Webhook delivery is at-least-once**, so events are deduplicated by id. If a handler fails, the dedup record is released so Stripe's retry is actually processed rather than dismissed as a duplicate.

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
