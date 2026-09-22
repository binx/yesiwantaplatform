# ✉️ Yes I Want A Postcard

A postcard subscription platform for artists.

An artist opens a studio, sets a monthly price, and queues one postcard a
month — a photo they took on the front, a short note on the back. People
subscribe from the artist's page and give an address. On the mailing day,
every active subscriber is printed and mailed a card by [Lob](https://lob.com).
Billing is Stripe subscriptions; the platform keeps a print cost and a small
fee from each sent card and transfers the rest to the artist through Stripe
Connect.

Built from three earlier projects: the pitch and the look of
[yesiwantapostcard.com](https://yesiwantapostcard.com) (one artist, one
subscription), the print pipeline of
[Postcard Gifts](https://github.com/binx/postcards-v2) (design → Lob, tracking,
refusals kept in Lob's words), and the foundation both stand on,
[Beluga v2](https://github.com/binx/beluga-v2) (accounts, admin, Stripe
webhooks, email, image storage, dual-dialect database).

## How it works

1. **An artist opens a studio** at `/studio/new`: a name, an address under
   `/artist/`, a page in Markdown, a monthly price (no lower than the platform's
   floor) and the day of the month their cards go out. The page starts as a
   draft.
2. **They queue a card.** The studio's designer takes a photo and a note,
   makes the print-ready front at Lob's size and density on upload, and puts
   the design on a month. One card per calendar month per artist — the
   database enforces it, because each subscriber pays once a month.
3. **They go live.** The page becomes public and listed under `/artists`.
   Going live needs a card in the queue, so a new subscriber's first month is
   never empty.
4. **Someone says yes.** From the artist's page, a signed-in visitor gives an
   address (checked against USPS, saved to their account) and is sent to
   Stripe Checkout in subscription mode with the artist's price as an inline
   monthly `price_data`. The subscription row is written `incomplete`.
5. **The webhook activates it.** `checkout.session.completed` is the only thing
   that makes a subscription active; `invoice.paid` records each month as an
   order; `customer.subscription.*` mirrors Stripe's status; a cancellation
   winds down at the period end.
6. **The mailing day.** A sweep in the API process runs every fifteen minutes.
   A due mailing is turned into one `postcards` row per active subscriber
   (idempotently — a unique index on mailing × subscription), then each card
   is sent to Lob with the card's own id as the idempotency key. Lob's refusal
   is stored verbatim on the card and shown to the admin next to a Retry
   button; the subscriber sees "we're looking into it".
7. **The ledger.** The moment Lob accepts a card, a `payouts` row records the
   subscriber's price, the print cost, the platform fee and the artist's share,
   with the numbers as they were that moment. An hourly sweep transfers each
   pending share to the artist's Stripe Connect account, keyed on the row id.
   Artists still onboarding accrue and are paid the day they finish.

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

Neither needs Stripe or Lob to browse, open a studio and queue cards. To take
a subscription:

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
src/pages/        Landing, artists, an artist's page, the gallery, subscribe.
src/pages/account The subscriber: subscriptions, postcards, address, receipts.
src/pages/studio  The artist: overview, queue (designer), subscribers, earnings, page.
src/admin/        The operator. Loaded on demand.
server/           Express 5 API. fulfilment.ts is the three sweeps; connect.ts is Stripe Connect.
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
costs the platform, what the platform keeps per card, and the least an artist
may charge a month. Every ledger row is computed from the subscriber's price
snapshot on their subscription and the two costs as they stood when Lob
accepted the card; changing the settings later changes nothing already
recorded. `artistShareCents` in `shared/schema.ts` is the whole formula, and
the studio shows an artist what a card will earn before they set a price.

Subscriptions are charged on the platform's own Stripe account and shares are
sent on as separate transfers, rather than as destination charges with an
application fee: Stripe only offers a percentage fee on subscriptions, and
this platform's fee is a fixed amount per card. A transfer that Stripe
refuses for lack of settled balance is retried at the next hour; one it
refuses for good is parked for the admin with Stripe's reason.

### Invariants

1. **Money is integer cents, everywhere.** See `shared/money.ts`.
2. **Money never comes from the request.** The artist's price is read from
   their row at checkout; the platform's cut from settings by the ledger.
3. **The Stripe webhook is the only thing that activates a subscription,
   records a paid month, or marks an artist payable** (the studio's refresh
   button asks Stripe directly, which is the same authority).
4. **Webhook handling is idempotent.** Events are deduplicated by id.
5. **Every admin route is behind `requireAdmin` + `verifyCsrf`; every studio
   route behind `requireCustomer` + the caller's own artist row.** New routes
   go in `server/security.test.ts`'s matrices.
6. **Every schema change lands in both dialects.**
7. **Only the sweeps talk to Lob and make transfers**, and only their
   conditional claims decide who sends what. Our ids are the idempotency keys.
8. **Lob's refusal and Stripe's refusal are stored in their own words.**

## Deploying

Any host with a persistent disk and Node 22. `npm run build` then `npm start`.
`.env` in production needs `SESSION_SECRET`, `PUBLIC_URL`, the Stripe keys,
the Stripe webhook secret (a real endpoint in the Stripe dashboard pointed at
`/api/webhooks/stripe`, listening to account events too), `LOB_API_KEY` (a
`live_` key), `LOB_WEBHOOK_SECRET` (for delivery tracking), and `SMTP_URL`
plus `EMAIL_FROM`. There is no cron: the sweeps run inside the API process.
The admin overview warns about every one of these when it is missing.
