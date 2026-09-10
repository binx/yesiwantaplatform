# ✉️ Postcard Gifts

The site behind [postcardgifts.com](https://postcardgifts.com): design a postcard
from your own photo, write a note on the back, send it to as many people as you
like, and pick the days each one goes out. Printed and mailed by
[Lob](https://lob.com), paid for through Stripe.

Built on [Beluga v2](https://github.com/binx/beluga-v2) and cut down to one
product. Beluga's catalogue, collections, shipping zones, tax, staff accounts
and outbound webhooks are gone; its payments, customer accounts, abandoned-cart
reminders, email, image pipeline and admin stay.

## How it works

1. **Design.** `/create` takes a photo and a note. Saving posts the photo to
   `POST /api/designs`, which writes two files: the print-ready front — centre
   cropped to 6.25″ × 4.25″ at 300 dpi, rotated to landscape, with the density
   declared in the PNG — and a thumbnail. The buyer gets back a design id.
2. **Schedule and address.** One start date and a cadence spread the designs
   out; recipients come from a form, a CSV, or a signed-in customer's saved
   list. Every design goes to every recipient. That is one cart line.
3. **Pay.** Checkout reads the price of a postcard from settings, multiplies by
   designs × recipients, and hands Stripe an inline `price_data`. There is no
   Stripe Product to publish. The order and every postcard row are written as
   `pending`.
4. **Confirm.** Stripe's webhook marks the order paid and every card
   `scheduled`. Nothing else ever does.
5. **Print.** A sweep in the API process runs every fifteen minutes, claims
   each card whose day has come with a conditional update, sends it to Lob
   with the card's own id as the idempotency key, and records what Lob said.
   A refusal is stored in Lob's own words, shown on the order in the admin
   next to a Retry button, and emailed to nobody — the buyer sees "needs
   attention" and the merchant sees why.
6. **Tell the buyer.** One email at order time listing the schedule, and one
   per card on the day it goes to print, with Lob's expected delivery date and
   a link to the proof.

## Requirements

Node 22 (`nvm use`).

## Getting started

```bash
nvm use
npm install
npm run setup       # .env, database, admin account, price
npm run dev:all     # storefront on :5173, API on :4000
```

Or skip `setup`, run `dev:all`, and open <http://localhost:5173/setup>.

Neither needs Stripe or Lob to browse and design. To take a test payment:

```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Put the `whsec_…` it prints in `.env`, restart the API, and pay with
`4242 4242 4242 4242`.

To send a card to Lob's sandbox, put a `test_` key in `.env` as `LOB_API_KEY`
and press **Send a test postcard** under Settings → Printing. That exercises
the whole print pipeline against a real Lob endpoint and shows Lob's answer,
which is the check v1 never had and the reason its upload failures were
invisible.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run setup` | Interactive first-run setup |
| `npm run dev:all` | Storefront and API together |
| `npm run build` | Typecheck, compile the server to `dist-server/`, build the client to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` / `npm run lint` / `npm test` | What it says. `npm test` runs the dual-dialect database tests too. |
| `npm run test:e2e` | Playwright, against `data/e2e.sqlite` |
| `npm run db:migrate` / `npm run db:seed` / `npm run db:generate` | Migrations |

## Architecture

```
src/            React 19 storefront (Vite). src/pages/CreatePage.tsx is the product.
src/admin/      Admin and setup wizard, loaded on demand.
server/         Express 5 API. lob.ts talks to Lob; fulfilment.ts is the sweep.
db/             Drizzle schema (SQLite and Postgres), migrations, repositories.
shared/         zod contracts imported by both sides. postcards.ts is the domain.
print/back.hbs  The back of the card, rendered to HTML and sent to Lob.
emails/         Handlebars email templates.
e2e/            Playwright specs.
```

Two things live on disk and must persist across a redeploy: the SQLite file
under `data/` and uploaded imagery under `ASSETS_DIR` (`public/assets` by
default) — the store's own images and every design's print file and thumbnail.
Mount a volume for both, or point `ASSETS_S3_BUCKET` at a bucket and only the
database needs a home.

### Lob

`server/lob.ts` talks to Lob's REST API directly. The front goes up as a file
in the request rather than a public URL, so nothing has to be reachable from
Lob's side and it works the same under a bucket driver or on a laptop.

The back is rendered from `print/back.hbs` and sent as HTML, so nothing has to
exist in the Lob dashboard. If you kept v1's Lob template, set
`LOB_BACK_TEMPLATE_ID` and the same merge variables are sent instead.

Lob requires a `use_type` on every mailpiece; `LOB_USE_TYPE` defaults to
`operational`, which is what a postcard a person writes to a friend is.

Designs nobody bought are deleted after a month. Once every card of a design
has gone to Lob, its print file is removed and the thumbnail kept, so the order
page still shows what was sent.

Every recipient is checked against Lob's US address verification as it is
added, so a ZIP that USPS does not know is caught while the buyer is looking
at the field rather than by the printer after payment. USPS's form of an
address is offered back; an address USPS does not recognise keeps the batch
out of the cart until it is fixed. With no `LOB_API_KEY`, or with Lob down,
nothing is checked and nothing is blocked. The route is rate-limited and the
answers cached for a day, because verifications past the plan's allowance
are billed.

### Customer accounts

Sign in, order history, password reset — and **saved recipients**: the people a
customer has sent to are saved when an order is paid, and the designer offers
them again. Orders are linked to an account only after the email is verified,
so registering with a stranger's address cannot read their order history.

### Abandoned cart reminders

Off by default. A signed-in customer with a verified email who leaves designs
in their cart gets exactly one reminder, priced from settings at send time,
with a single-use recovery link.

### Payments

Checkout Sessions, webhook-authoritative order state, refunds from the admin
recorded only when Stripe's `charge.refunded` lands. A full refund withdraws
every card that has not gone to print; a partial one leaves the schedule alone.
Discount codes are created in the Stripe dashboard and accepted at checkout.

## Secrets

Never commit keys. `.env` locally, platform environment variables in
production. The Stripe secret key and the Lob key are server-only.
