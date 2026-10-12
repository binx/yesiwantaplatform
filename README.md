# ✉️ Yes I Want A Postcard

Editions of postcards, by artists, in the mail.

An artist makes an edition: a set of 6 or 12 postcards — photos or drawings
on the front, a short note on the back — sent monthly or twice a month, at one
price. They can have several: flowers, birds, a road trip. Someone collects an
edition from the artist's page, pays once, and picks the day it starts. Each
card is printed and mailed by [Lob](https://lob.com) on its day. The platform
keeps a print cost and a small fee from each sent card and transfers the rest
to the artist through Stripe Connect.

Built from three earlier projects: the pitch and the look of
[yesiwantapostcard.com](https://yesiwantapostcard.com) (one artist, one
subscription), the print pipeline of
[Postcard Gifts](https://github.com/binx/postcards-v2) (design → Lob, tracking,
refusals kept in Lob's words), and the foundation both stand on,
[Beluga v2](https://github.com/binx/beluga-v2) (accounts, admin, Stripe
webhooks, email, image storage, dual-dialect database).

## How it works

1. **An artist opens a studio** at `/studio/new`: a name, an address under
   `/artist/`, a page in Markdown. The page starts as a draft.
2. **They make an edition.** A title, a description, a size (6 or 12 cards),
   a cadence (monthly or twice a month) and a price for the whole set, no
   lower than the platform's floor per card times the size. The studio's
   designer takes each image and note, makes the print-ready front at Lob's
   size and density on upload, and puts the designs in the edition's slots,
   in order.
3. **They put it on sale and go live.** An edition goes on sale only with
   every card in place, and from then on its cards, size, cadence and price
   are fixed — collectors paid for exactly those. Going live needs an
   edition on sale. An edition can be closed to new collectors at any time;
   everyone who paid still gets every card.
4. **Someone says yes.** From the edition's page, a signed-in visitor gives
   an address (checked against USPS, saved to their account) and, if they
   like, the day the first card should go — otherwise the next 1st or 15th.
   They are sent to Stripe Checkout in payment mode with the edition's price
   as an inline one-time `price_data`. The purchase row is written
   `incomplete`.
5. **The webhook marks it paid and writes the run.**
   `checkout.session.completed` is the only thing that marks a purchase paid,
   and the moment it does every card of the run is written as a `postcards`
   row with its own mail date (idempotently — a unique index on purchase ×
   position). Monthly runs land on the start day each month; twice-a-month
   runs on that day and the one fourteen days from it. `charge.refunded`
   records refunds; a full refund withdraws every card not yet sent.
6. **Each card's day.** A sweep in the API process runs every fifteen
   minutes and sends every card whose day has come to Lob, with the card's
   own id as the idempotency key. Lob's refusal is stored verbatim on the
   card and shown to the admin next to a Retry button; the collector sees
   "we're looking into it". A collector who moves updates every card still
   to come.
7. **The ledger.** The moment Lob accepts a card, a `payouts` row records
   that card's part of the price, the print cost, the platform fee and the
   artist's share, with the numbers as they were that moment. An hourly
   sweep transfers each pending share to the artist's Stripe Connect
   account, keyed on the row id. Artists still onboarding accrue and are
   paid the day they finish.

Everyone signs in the same way. An artist is a customer with an artist row;
the studio is a third authorization surface on top of the customer's, and the
admin is a fourth that neither can reach. `server/security.test.ts` asserts
every route against every session type.

## Requirements

Node 22 (`nvm use`).

## Getting started

```bash
nvm use
npm install
npm run setup       # .env, database, admin account, pricing
npm run dev:all     # site on :5173, API on :4000
```

Or skip `setup`, run `dev:all`, and open <http://localhost:5173/setup>.

Neither needs Stripe or Lob to browse, open a studio and make an edition. To
sell one:

```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Put the `whsec_…` it prints in `.env` with `sk_test_…`, restart the API, and
pay with `4242 4242 4242 4242`. `stripe listen` forwards Connect events too,
which is how an artist's onboarding status reaches the ledger. In the Stripe
dashboard, enable Connect (Express accounts) before an artist tries to set up
payouts.

To send a card to Lob's sandbox, put a `test_` key in `.env` as `LOB_API_KEY`
and press **Send a test postcard** under Admin → Settings → Printing.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run setup` | Interactive first-run setup |
| `npm run dev:all` | Site and API together |
| `npm run build` | Typecheck, compile the server to `dist-server/`, build the client to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` / `npm run lint` / `npm test` | What it says. `npm test` runs the dual-dialect database tests too. |
| `npm run test:e2e` | Playwright, against `data/e2e.sqlite` |
| `npm run db:migrate` / `npm run db:seed` / `npm run db:generate` | Migrations |

## Architecture

```
src/              React 19 site (Vite).
src/pages/        Landing, artists, an artist's page, an edition, the gallery, collect.
src/pages/account The collector: collections (and receipts), postcards, address.
src/pages/studio  The artist: overview, editions (and the designer), collectors, earnings, page.
src/admin/        The operator. Loaded on demand.
server/           Express 5 API. fulfilment.ts is the print and payout sweeps; connect.ts is Stripe Connect.
server/routes/    public, account, studio, checkout, webhook, admin, lob-webhook.
db/               Drizzle schema (SQLite and Postgres), migrations, repositories.
shared/           zod contracts imported by both sides. platform.ts is the domain.
print/back.hbs    The back of the card, rendered to HTML and sent to Lob.
emails/           Handlebars email templates.
e2e/              Playwright specs.
```

Two things live on disk and must persist across a redeploy: the SQLite file
under `data/` and uploaded imagery under `ASSETS_DIR` (`public/assets` by
default) — avatars, and every design's print file and thumbnail. Mount a
volume for both, or point `ASSETS_S3_BUCKET` at a bucket and only the
database needs a home.

### The money

Three numbers in Admin → Settings → Pricing: what one printed and mailed card
costs the platform, the percentage of each card's share the platform keeps,
and the least an edition may charge per card. Every ledger row is computed from the price
snapshot on the purchase — split evenly across the set, the odd cents on
card 1 — and the two costs as they stood when Lob accepted the card;
changing the settings later changes nothing already recorded.
`cardGrossCents` and `artistShareCents` in `shared/schema.ts` are the whole
formula, and the studio shows an artist what a card will earn before they set
a price.

Purchases are charged on the platform's own Stripe account and shares are
sent on as separate transfers, one per card as it is mailed, rather than as a
destination charge at checkout: the artist earns a card's share when the card
exists, so a refund before then costs them nothing, and the platform's fee is
a fixed amount per card. A transfer that Stripe
refuses for lack of settled balance is retried at the next hour; one it
refuses for good is parked for the admin with Stripe's reason.

### Invariants

1. **Money is integer cents, everywhere.** See `shared/money.ts`.
2. **Money never comes from the request.** An edition's price is read from
   its row at checkout; the platform's cut from settings by the ledger.
3. **The Stripe webhook is the only thing that marks a purchase paid, writes
   its cards, records a refund, or marks an artist payable** (the studio's
   refresh button asks Stripe directly, which is the same authority).
4. **Webhook handling is idempotent.** Events are deduplicated by id.
5. **Every admin route is behind `requireAdmin` + `verifyCsrf`; every studio
   route behind `requireCustomer` + the caller's own artist row.** New routes
   go in `server/security.test.ts`'s matrices.
6. **Every schema change lands in both dialects.**
7. **Only the sweeps talk to Lob and make transfers**, and only their
   conditional claims decide who sends what. Our ids are the idempotency keys.
8. **An edition on sale is fixed**: its cards, size, cadence and price.
9. **Lob's refusal and Stripe's refusal are stored in their own words.**

## Deploying

Any host with a persistent disk and Node 22. `npm run build` then `npm start`.
`.env` in production needs `SESSION_SECRET`, `PUBLIC_URL`, the Stripe keys,
the Stripe webhook secret (a real endpoint in the Stripe dashboard pointed at
`/api/webhooks/stripe`, listening to account events too), `LOB_API_KEY` (a
`live_` key), `LOB_WEBHOOK_SECRET` (for delivery tracking), and `SMTP_URL`
plus `EMAIL_FROM`. There is no cron: the sweeps run inside the API process.
The admin overview warns about every one of these when it is missing.
