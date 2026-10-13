# CLAUDE.md

## What this is

Yes I Want A Postcard: artists sell editions of postcards. An edition is a
set of 6 or 12 cards at one price. A collector pays for the whole set once,
picks whether the cards come once or twice a month and the day their run
starts (default: the next 1st or 15th), and Lob prints and mails each card
on its day. Each sent card earns the artist its share of the price, less a print
cost and a platform fee, transferred through Stripe Connect.

Forked from postcards-v2 (`git remote postcards`), itself a fork of Beluga v2
(`git remote beluga`). Their invariants still hold, plus this platform's own:

1. **Money is integer cents, everywhere.** See `shared/money.ts`.
2. **Money never comes from the request.** An edition's price is read from
   its row at checkout and snapshotted on the purchase; the platform's cut
   from `store_settings` by the ledger. `cardGrossCents` and
   `artistShareCents` in `shared/schema.ts` are the one formula.
3. **The Stripe webhook is the only thing that marks a purchase paid, writes
   its cards, records a refund, or flips an artist to payable** (besides the
   studio's own refresh, which asks Stripe).
4. **Webhook handling is idempotent.** Events are deduplicated by id in
   `webhook_events`; Lob's are prefixed `lob:`.
5. **Three auth surfaces, never crossing.** `requireAdmin` reads `adminId`,
   `requireCustomer` reads `customerId`, and the studio's `requireArtist`
   loads the caller's own artist row — nothing in the studio takes an artist
   id from the request. Every new route goes in `server/security.test.ts`'s
   `MUTATIONS`, `READS`, `CUSTOMER_*` or `STUDIO_*` lists. Not optional.
6. **Every schema change lands in both dialects.** Edit `db/schema.sqlite.ts`
   and `db/schema.pg.ts` together, then `npm run db:generate`, commit both
   migration folders. `db/dialect.test.ts` runs against both engines.
7. **Only `server/fulfilment.ts` talks to Lob and creates transfers**, and
   only its conditional claims (`claimPostcard`, `claimPayout`) decide who
   does what. Our ids are the idempotency keys. Never send or transfer from
   a request handler.
8. **An edition on sale is fixed.** Its cards, size, price and slug change
   only as a `draft` (the repository's conditional updates hold it, not just
   the route), and it goes back to draft only if nobody ever bought it. The
   cadence is not the edition's at all: the collector chooses it at checkout
   and it is snapshotted on the purchase. One card per purchase per position: the unique index on
   `postcards (purchase_id, position)` makes writing a run idempotent.
9. **Refusals are stored in the other party's words.** Lob's on the postcard
   row, Stripe's on the payout row. Shown in full to the admin only;
   collectors and artists get "we're looking into it".
10. **Artists never see who collects.** The studio has no list of
    purchases, only `collectorCount`; names and addresses never leave the
    platform's side. The platform mails.
11. **Only the admin's review puts an edition on sale the first time, and
    only an approved artist goes live.** A studio opens `pending`; a draft
    is sent `in_review` by its artist and reaches `on_sale` only through
    `reviewEdition`. The studio's status route never moves draft to
    on_sale. Both directions email: the admin when something is sent, the
    artist when it is decided. The artist directory lists only live artists
    with an edition on sale.

## Layout

```
src/            React 19 site (Vite). pages/, pages/account/, pages/studio/, admin/.
server/         Express 5 API. fulfilment.ts: the print and payout sweeps. connect.ts: Stripe Connect.
server/routes/  public, account, studio, checkout, webhook, admin, lob-webhook, site.
server/presenters.ts  rows → what each audience may see, parsed with the shared schemas.
db/             Drizzle schema (both dialects), migrations, one repository per table.
shared/         zod contracts imported by both sides. platform.ts is the domain.
print/          The back of the card, as Handlebars HTML sent to Lob.
emails/         Handlebars email templates.
e2e/            Playwright.
```

## Commands

```bash
nvm use                 # Node 22 — system Node 18 fails with misleading errors
npm run dev:all         # site :5173, API :4000
npm run typecheck && npm run lint && npm test
npm run test:e2e        # needs data/e2e.sqlite migrated + seeded once
```

`server/lifecycle.test.ts` is the whole story end to end against a fake Lob
and a stubbed Stripe; read it before changing the sweeps or the webhook.

## UI copy

No explanation lines after controls. A label names the field and nothing
follows the input, button or radio group: no help text, no sentence about
what the setting means, no example, no "optional". Section headings stand
alone, with no intro paragraph under them. The one thing that may appear
under a control is an error, in one sentence, only while the input is
invalid. If a control needs a sentence to be understood, rename the control.

## Branching

Base branch is `main`. Branch for every task; leave the checkout on `main`
when a task lands, and delete the branch with `-d`, never `-D`.
