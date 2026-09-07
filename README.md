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
| 2 | Database (SQLite/Postgres), API server, security | ⬜ Next |
| 3 | Stripe Checkout Sessions, webhooks, orders, email | ⬜ |
| 4 | Storefront polish, carousel, accessibility | ⬜ |
| 5 | Setup wizard, admin, product editor | ⬜ |

**What works today:** browsing, variants, cart, and theming, running against a bundled demo catalogue.
**What doesn't:** checkout, the admin, and anything touching Stripe. v1's code is parked in [`legacy/`](legacy/) as reference until Phases 3–5 replace it.

## Requirements

Node 22 or newer (`.nvmrc` is provided — run `nvm use`). v1's Node 18 is past end of life and cannot run the current build tooling.

## Getting started

```bash
nvm use
npm install
npm run dev
```

That serves the demo store at http://localhost:5173. No Stripe account, database, or configuration file is needed yet — v1 crashed on first run if `config.env` was missing, which is one of the things Phase 5 fixes.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck, then production build |
| `npm run typecheck` | Types only |
| `npm run lint` | ESLint |
| `npm test` | Unit and component tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright) |

## Architecture

```
src/       React 19 storefront (Vite)
shared/    zod schemas + catalogue helpers, shared with the API
e2e/       Playwright specs
legacy/    v1 code, kept for reference — not built
```

`shared/schema.ts` is the contract between the storefront and its data. Phase 1 renders a validated fixture (`src/fixtures/demo-store.ts`); Phase 2 swaps in the database behind the same schema, changing only `src/lib/store-source.ts`.

Two conventions worth knowing before contributing:

- **Money is always integer cents.** v1 stored floats and multiplied by 100, which sent amounts like `1998.9999999999998` to Stripe. See `shared/money.ts`.
- **The cart stores identifiers only** — never prices or image URLs. Everything displayable is derived from the current catalogue, so a price change can't leave stale amounts in someone's open cart.

## Secrets

Never commit keys. Copy `.env.example` to `.env` for local development and use platform environment variables in production. The Stripe **secret** key is server-only; only the publishable key is ever sent to the browser.

v1 shipped a `config.env` that the server rewrote at runtime to store the admin password hash. v2 does not do this — see Phase 2.

---

Beluga is the next iteration of [react-stripe-store](https://github.com/binx/react-stripe-store).

<a href="https://www.buymeacoffee.com/binx" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/lato-blue.png" alt="Buy Me A Coffee" height="51px" width="217px"></a>
