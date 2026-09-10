# CLAUDE.md

## What this is

postcardgifts.com, rebuilt on Beluga v2. One product — a postcard the buyer
designs — printed and mailed by Lob on a day the buyer picks. There is no
catalogue: the price is a setting, and Stripe is charged through inline
`price_data`.

The Beluga upstream is `git remote upstream` (binx/beluga-v2). Beluga's
invariants still hold here and are the first thing to read:

1. **Money is integer cents, everywhere.** See `shared/money.ts`.
2. **Money never comes from the request.** Checkout reads the price from
   `store_settings` and multiplies by designs × recipients. A request carries
   design ids, dates and recipients only.
3. **The webhook is the only thing that marks an order paid** — and the only
   thing that moves postcards from `pending` to `scheduled`.
4. **Webhook handling is idempotent.** Events are deduplicated by id.
5. **Every admin route is behind `requireAdmin` + `verifyCsrf`**, applied once
   to the router in `server/routes/admin.ts`. New routes go in
   `server/security.test.ts`'s `MUTATIONS` or `READS`. Not optional.
6. **Every schema change lands in both dialects.** Edit `db/schema.sqlite.ts`
   and `db/schema.pg.ts` together, then `npm run db:generate`, commit both
   migration folders. `db/dialect.test.ts` runs against both engines.
7. **Only the fulfilment sweep talks to Lob**, and only `claimPostcard`'s
   conditional update decides who sends a card. Our postcard id is Lob's
   idempotency key. Never send from a request handler.
8. **Lob's refusal is stored in Lob's words** on the postcard row. Do not
   paraphrase it, drop it, or turn it into a generic message — the reason v1
   was undebuggable was that it did exactly that.

## Layout

```
src/            React 19 storefront (Vite). src/pages/CreatePage.tsx is the product.
src/admin/      Admin and setup wizard, loaded on demand.
server/         Express 5 API. lob.ts talks to Lob; fulfilment.ts is the sweep.
db/             Drizzle schema (both dialects), migrations, repositories.
shared/         zod contracts imported by both sides. postcards.ts is the domain.
print/          The back of the card, as Handlebars HTML sent to Lob.
emails/         Handlebars email templates.
e2e/            Playwright.
```

## Commands

```bash
nvm use                 # Node 22
npm run dev:all         # storefront :5173, API :4000
npm run typecheck && npm run lint && npm test
npm run test:e2e        # needs data/e2e.sqlite migrated + seeded once
```

## Branching

Base branch is `main`. Branch for every task; leave the checkout on `main`
when a task lands.
