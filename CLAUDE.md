# CLAUDE.md

## What this is

Yes I Want A Postcard: a postcard subscription platform for artists. An artist
queues one postcard a month; subscribers pay a monthly price; on the mailing
day every active subscriber is printed and mailed a card by Lob; the platform
keeps a print cost and a fee per sent card and transfers the rest to the
artist through Stripe Connect.

Forked from postcards-v2 (`git remote postcards`), itself a fork of Beluga v2
(`git remote beluga`). Their invariants still hold, plus this platform's own:

1. **Money is integer cents, everywhere.** See `shared/money.ts`.
2. **Money never comes from the request.** The artist's price is read from
   their row at checkout; the platform's cut from `store_settings` by the
   ledger. `artistShareCents` in `shared/schema.ts` is the one formula.
3. **The Stripe webhook is the only thing that activates a subscription,
   records a paid month, or flips an artist to payable** (besides the
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
   only its conditional claims (`claimPostcard`, `claimPayout`,
   `markMailingMailed`) decide who does what. Our ids are the idempotency
   keys. Never send or transfer from a request handler.
8. **One mailing per artist per calendar month.** The unique index on
   `mailings (artist_id, period)` is the rule; `PeriodTakenError` is how the
   studio says it. A subscriber pays once a month, so a second card would be
   paid for by nobody.
9. **Refusals are stored in the other party's words.** Lob's on the postcard
   row, Stripe's on the payout row. Shown in full to the admin only;
   subscribers and artists get "we're looking into it".
10. **Artists never see a street address.** `toSubscriber` and the studio's
    postcards route strip it. The platform mails; the artist gets a name and
    a town.

## Layout

```
src/            React 19 site (Vite). pages/, pages/account/, pages/studio/, admin/.
server/         Express 5 API. fulfilment.ts: the three sweeps. connect.ts: Stripe Connect.
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

## Branching

Base branch is `main`. Branch for every task; leave the checkout on `main`
when a task lands, and delete the branch with `-d`, never `-D`.
