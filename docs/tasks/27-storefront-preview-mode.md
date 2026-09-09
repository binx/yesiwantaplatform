---
task: "27"
title: A store that is deployed but not yet open
status: todo
tier: 0
size: M
migration: four columns on store_settings
blocked_by: []
blocks: []
touches: server/app.ts:75 · server/middleware.ts · server/routes/storefront.ts · db/schema.{sqlite,pg}.ts · src/lib/store-source.ts · src/components/layout/StoreErrorBoundary.tsx · src/admin/SettingsPage.tsx:210 · src/admin/goLive.ts
completed:
shipped_in:
summary: >-
  Beluga has exactly two states: not set up, and open to the internet. There is no state
  for *deployed, being built, shown to three people for feedback* — so the whole middle of
  the job happens either on localhost, where Stripe webhooks and email cannot be tested,
  or in public with a half-finished shop and a test Stripe key. Add one setting that puts
  the storefront behind a shared password, a share link for reviewers, and an **Open the
  store** switch behind a checklist of live state — not a launch wizard, because most of
  what it checks is an environment variable and a restart.
---

# 27 · A store that is deployed but not yet open

Building a store is not one sitting. The design gets iterated on, Stripe gets
connected, SMTP gets a real sender, shipping zones get argued about, and
somewhere in there the work has to be shown to a client or a collaborator. Every
one of those steps wants a *deployed* store — webhooks cannot reach localhost,
`PUBLIC_URL` has to be true for Stripe redirects to work (task 18), and "look at
my laptop" is not feedback.

Beluga's storefront has two states today. `getStoreSnapshot()` returns `null`
and every visitor is told to run the setup wizard, or it returns a store and
every visitor sees the shop. Nothing in between. So the deploy that makes the
rest of the wiring testable is the same deploy that publishes a shop with three
placeholder products, no shipping rates, hero copy that says *Edit it in the
admin*, and — worst of all — a working checkout on an `sk_test_` key.

## Why this is not a test/live switch

The obvious framing is a mode flag: test mode, then live mode, flip it when
ready. Resist it. **Beluga already has a test/live axis and it is the Stripe
secret key** — `sk_test_` or `sk_live_`, read at `server/routes/setup.ts:66` and
reported as `stripeMode` by `/api/admin/environment`
(`server/routes/admin.ts:175`). That is also Stripe's own model: the key *is* the
mode, which is why there is no account-level switch to get out of step with.

A second, database-backed mode would be a second source of truth for the same
question, and the interesting states are the contradictions: a store set to
"live" holding a test key, a store set to "test" holding a live one. Both are
states someone would have to write code to interpret, and neither means
anything. Don't create them.

What is actually missing is one thing the Stripe key cannot express: **who is
allowed to look at the storefront.** Add that, and the go-live moment stops
being a mode change and becomes what it really is — a deliberate act with a
checklist in front of it.

## 1 · The setting

Four columns on `store_settings` (`db/schema.sqlite.ts:23`,
`db/schema.pg.ts:27`), both dialects, one migration each:

| Column | Type | Notes |
| --- | --- | --- |
| `storefront_access` | text, not null, default `'public'` | `'public'` \| `'password'` |
| `storefront_password_hash` | text, nullable | argon2id, via `server/auth.ts` |
| `storefront_share_token` | text, nullable, unique | The reviewer's credential |
| `storefront_access_version` | integer, not null, default `0` | See revocation, below |

**The default is `'public'`, and that is load-bearing.** Every store that
already exists must come through this migration behaving exactly as it does now.
A store gets locked because someone asked for it, never because they upgraded.

The setup wizard should offer it, though — one question, in both the terminal
(`scripts/setup.ts`, next to the `PUBLIC_URL` question task 18 added at line
357) and the browser wizard. Default the answer to *password* when the
`PUBLIC_URL` just given is not localhost, because that is precisely the case
where the store is reachable before it is finished. Same reasoning as
`activeSetupToken()` (`server/routes/setup.ts:59`): a fresh public address is
port-scanned within minutes, and the storefront has had no equivalent of the
setup token.

## 2 · The gate, and where it mounts

`createApp()` (`server/app.ts:24`) mounts routers in a deliberate order.
Position, not an allow-list, should decide what the gate covers — an allow-list
fails open for the next route somebody adds, and a positional choke point fails
closed.

Mount `requireStorefrontAccess` **after** these, so each is exempt by being
above it:

- `app.use("/api", webhookRouter)` at line 47 — **this one matters most.**
  Gating Stripe's webhook would break the only thing that marks an order paid,
  during exactly the phase when a merchant is testing that it works. It is
  already mounted before sessions, so it is exempt for free; do not move it.
- `GET /api/health` at line 73 — a platform health check gets no password, and
  gating it fails the deploy.
- `sessionRouter` (line 75) and `setupRouter` (line 76) — the admin sign-in and
  the wizard.
- `siteRouter` (line 83) — see §4; it must answer crawlers, with different
  content.
- `express.static(dist)` (line 108) — the client bundle. The gate is rendered by
  the SPA, so the SPA has to be downloadable.

Everything below it is gated by position: `publicRouter`, `accountRouter`,
`checkoutRouter`, `shippingRouter`, `cartRouter`, `adminRouter`, the `/assets`
mount at line 91, and the HTML fallback at line 120. Move the two mounts that
are currently in the wrong place (`siteRouter` is already above `/assets`; the
`/assets` mount needs to move below the gate).

The gate passes when **any** of:

- `storefront_access` is `'public'`;
- `req.session.storefrontAccess === storefront_access_version`;
- `req.session.adminId` is set — an administrator has already proved more than
  the storefront password proves, and `adminRouter` sits below the gate;
- the path starts with `/admin` or `/setup` — the merchant has to be able to
  reach the sign-in page, and both are client routes served by the HTML
  fallback.

Otherwise:

- `/api/*` → **401** `{ error, needsStorefrontPassword: true }`. 401 rather than
  403 because the client's job is to distinguish "locked" from "broken", the
  same distinction `store-source.ts` already draws for the 503 that means "not
  set up".
- everything else → the HTML shell, so the SPA can boot and render the gate.
- always → `X-Robots-Tag: noindex, nofollow`, so a link that leaks is not
  indexed while it is leaking.

## 3 · What a locked store must not answer

Write the test first and enumerate. Each of these returns something a
half-finished store should not be handing out:

- `/api/store` — name, theme, live products with prices, page titles
- `/api/products`, `/api/products/:slug`, `/api/collections`
- `/api/pages`, `/api/pages/:slug`
- `/api/checkout`, `/api/shipping/quote`, `/api/cart/*`
- `/api/account/*`, including register and sign-in — a locked store should not
  be collecting customer accounts
- `/assets/*` — uploaded imagery. The filenames are UUIDs
  (`server/uploads.ts:121`), so this is defence in depth rather than the
  protection itself; the protection is that the URLs only ever appear in a
  gated payload.
- **the HTML shell's `<head>`.** This is the one that will get missed.
  `app.ts:120` calls `metaForPath(req.path)` and injects the result, so an
  anonymous `GET /product/canvas-tote` currently returns the product's name,
  description, price and image in `og:` tags and JSON-LD *without rendering
  anything*. While locked, skip `metaForPath` entirely and inject a fixed
  generic head — no title beyond a neutral one, no description, no image, no
  JSON-LD.

Add a test in the shape of `server/security.test.ts`: a `LOCKED` array of paths,
each asserted to answer 401 to an anonymous caller and 200 once unlocked, plus
the mirror assertion that the webhook and `/api/health` answer either way. The
README's definition of done already makes adding routes to that file
non-optional; this array is the same contract for the same reason.

## 4 · Crawlers

`siteRouter` stays above the gate and reads the setting itself, because a
crawler that already has the URL should be told to leave rather than given a
401 it will retry:

- `robots.txt` → `User-agent: *` / `Disallow: /`, and **no `Sitemap:` line**.
- `sitemap.xml` → 404. It currently lists every live product and page
  (`server/routes/site.ts:32`), which is the whole catalogue in one
  unauthenticated request.

## 5 · The gate page

Client-side, in the storefront bundle, with no server-rendered second
implementation to keep in step — and `StoreErrorBoundary`
(`src/components/layout/StoreErrorBoundary.tsx`) is already the seam. It
distinguishes `StoreNotSetUpError` from a transport failure today; add a third
branch.

- `loadStore()` (`src/lib/store-source.ts:19`) throws a new
  `StorefrontLockedError` on 401, next to the existing 503 branch.
- The boundary renders a password form: one field, a submit, and a line of copy
  that says the store is not open yet and nothing about whose it is.
- Submit posts to `POST /api/storefront/unlock` `{ password }` → 204. On success,
  invalidate `storeQueryKey` and the boundary's children mount normally.
- Nothing else in the storefront changes. Once past the gate a reviewer is an
  ordinary shopper: they can browse, add to cart, and complete a test checkout —
  which is the point, since that is the wiring being tested.

The consequence to accept and to write down: the bundle is served to anyone, so
a locked store's *code* is readable. It is the same open-source bundle every
Beluga store ships. What is protected is the store's data, and that is the thing
worth protecting.

## 6 · The share link

A shared password is a bad thing to send to a client, and the merchant would
have to keep a copy of it somewhere, which argues for storing it in a form the
admin can display — i.e. not hashed. Don't. Hash the password, and make the
*link* the thing you send:

- `POST /api/admin/storefront/share-link` mints a 32-byte token, stores it, and
  returns the full URL — `<PUBLIC_URL>/?preview=<token>` — **once**, on
  creation, in the response body. Same handling as the webhook signing secret
  from task 14, for the same reason.
- `DELETE /api/admin/storefront/share-link` revokes it. Minting a new one
  replaces the old.
- The client reads `?preview=` on boot, posts it to
  `POST /api/storefront/unlock` `{ token }`, then strips it with
  `history.replaceState`. **Posted, not read from the query string server-side**,
  which keeps the token out of the server's access log, the platform's request
  log, and every proxy in between — the ordinary fate of a credential in a URL.

One token, not a table of them. Per-reviewer revocation is a real feature and a
real table; a pre-launch store with four viewers is served by rotating the one
token, and that keeps this brief at four columns.

## 7 · Turning it on, and why there is no wizard

### There is no walkthrough, and that is the design

The obvious build is a launch wizard: six steps, a green tick each, *Next*
until the store opens. Two reasons not to.

**The audience.** `docs/site-plan.md` §1 fixes the reader as *a developer
building a custom store on top of Beluga*, and draws the conclusion
explicitly: **no hand-holding, and no click-throughs — no numbered screenshot
tours.** A launch wizard is the largest click-through in the product.

**Four of the six things cannot be fixed in the UI at all.**
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_URL`, `SMTP_URL` and
`EMAIL_FROM` are environment variables read once at boot (`server/env.ts`), by
deliberate design — v1 kept secrets in a tracked `config.env` that the server
rewrote at runtime, and not doing that again is a stated invariant. So a wizard
step for any of them is a step with nothing to click: it can name the variable
and then must survive the process restart that applies it, mid-flow, having
lost its own state. A wizard implies *fix it here*; for most of this list there
is no here.

So: **a checklist that reports live state, not a sequence that marches through
it.** Each row says what is true right now, and then either links to the admin
page that changes it or names the environment variable and says the API has to
restart. That is the difference between walking someone through the steps and
telling them, accurately, which ones are outstanding — and the second is the
one that is honest about where the levers actually are.

### The idiom already exists — build it in the shape of the Tax card

Do not invent a layout. `SettingsPage.tsx:210` is this component already: a
`Card`, a `styles.wiring` paragraph saying what the feature does and does not
do, an `info` `Alert` whose description is a `<ul className={styles.checklist}>`
of *things that have to be true before this is correct*, and then a
`styles.toggleRow` — `Switch`, `styles.toggleLabel`, `styles.help` — where the
label states the current state as a fact ("Collecting tax at checkout" /
"Not collecting tax") rather than naming the action.

`.checklist`, `.toggleRow`, `.toggleLabel` and `.help` are already in
`SettingsPage.module.css`. A **Visibility** card built this way needs no new
CSS and will look like it was always there.

Same grammar for the label: *"Open to everyone"* / *"Password required"*, with
the help line underneath saying what that means for a visitor.

### The rows

One module — `src/admin/goLive.ts` — exports the row computation. Three things
render it and none of them recomputes it, because a checklist that disagrees
with the Overview is worse than no checklist:

| Row | Read from | When it fails, the row offers |
| --- | --- | --- |
| Stripe is connected | `hasStripeSecret` | `STRIPE_SECRET_KEY`, and a restart |
| The Stripe key is a live key | `stripeMode` | swap the key, and a restart |
| Webhooks are connected | `hasWebhookSecret` | `STRIPE_WEBHOOK_SECRET`, and a restart |
| The public URL is not localhost | `publicUrl` | `PUBLIC_URL`, and a restart |
| Shipping has rates, and they cover where you ship | the shipping table | a link to `/admin/shipping` |
| Email can be sent | `hasEmail` | `SMTP_URL` and `EMAIL_FROM`, and a restart |
| Something is live to buy | live product count | a link to `/admin/products` |

The first six come from `/api/admin/environment`
(`server/routes/admin.ts:175`). **Task 19 already computes the shipping rows
and wrote the copy for them** in the Overview's `Wiring`
(`src/admin/DashboardPage.tsx`) — reuse those reads and that wording rather
than writing a second opinion about the same table. If moving `Wiring` onto
`goLive.ts` is cheap in the same PR, do it; what must not happen is a third
copy.

### Where it appears

1. **Settings → Visibility**, inline and always visible, whichever state the
   store is in — exactly as the Tax card's Alert is always there. The point of
   the checklist is to be readable for the fortnight *before* anyone reaches for
   the switch, not to appear as a surprise at the moment of the click.
2. **The confirmation on flipping to public**, listing the failing rows only,
   with the passing ones collapsed to a count. A merchant who has read the card
   all week does not need the full list read back to them.
3. **The Overview**, which keeps its existing notices unchanged.

### The switch itself

**Nothing on the list blocks it.** A catalogue-only store with no Stripe at all
is legitimate, a store that ships one country from one flat rate is legitimate,
and Beluga does not get to decide a merchant is not ready to open their own
shop. The list is shown; the button under it says what it does — *Open the
store* — and the toast afterwards says *This store is open*.

Closing it again is the same switch with no ceremony. A store that opened too
early should be one click from being private again, and a confirmation on the
way back in would only make someone hesitate at the moment they most want to
act.

The one state that deserves more than a list is **public and holding a test
key**. That is worse than the broken shop this brief exists to prevent:
checkout completes, the buyer sees a confirmation, the webhook records a paid
order, and no money moved. Add it to the Overview as a persistent
`error`-level notice — the one thing on that page that is not `info` or
`warning` — and keep it there until the key or the visibility changes.

## Security

- argon2id via the existing helpers in `server/auth.ts`. Never a plaintext
  password column, never the hash over the wire. `GET /api/admin/storefront`
  returns `{ access, hasPassword, hasShareLink, shareLinkCreatedAt }` and no
  secret.
- The password and the token live on **dedicated routes**, not in
  `settingsInputSchema` (`shared/api.ts:134`). That schema is a full-object PUT
  with `.default()` on nearly every field, so a secret in it would be cleared by
  any client that omitted it.
- `POST /api/storefront/unlock` gets `loginRateLimit`
  (`server/middleware.ts:58`), and unlike a login it must **not**
  `skipSuccessfulRequests` — a valid guess should still count, because a shared
  password has no account to lock and no owner to notice.
- No CSRF check on the unlock route, and say why in a comment: the forgeable
  action is *granting a victim read access to a store whose password the attacker
  already knows*, which is not a threat. `PUBLIC_CART_TOKEN_ROUTES` in
  `server/security.test.ts:141` is the precedent for recording a deliberate
  omission rather than leaving it to be discovered.
- Regenerate the session on a successful unlock, as every other privilege change
  in this codebase does.
- **Revocation has to be real.** Session cookies are 24-hour rolling, so without
  something more, "change the password" leaves every existing viewer inside for
  up to a day. Hence `storefront_access_version`: the session stores the version
  it was granted under, the gate compares, and setting a password, clearing one,
  or rotating the share token bumps it. Every viewer is out on their next
  request; the admin session is unaffected because `adminId` passes the gate on
  its own.
- Refuse `access: 'password'` with no password set (409). It is not a lockout —
  an admin still gets in — but it is a state that means nothing.

## Acceptance

- A locked store answers 401 to every path in the `LOCKED` array for an
  anonymous caller, and 200 for each once unlocked.
- `POST /api/webhook` with a valid Stripe signature is processed while locked,
  and `GET /api/health` answers 200.
- `GET /product/<slug>` on a locked production build contains no product name,
  price, image or JSON-LD anywhere in the response body.
- `robots.txt` disallows everything and names no sitemap; `sitemap.xml` is 404.
- A share link unlocks the store, and the token is gone from `location.search`
  afterwards and absent from the server's request log.
- Rotating the share token or changing the password ends every existing viewer
  session on its next request, and leaves the admin signed in.
- An administrator reaches `/admin` and the whole admin API with no storefront
  password.
- Migrating an existing store leaves it public.
- An e2e spec covers the gate at both Playwright widths: locked landing page →
  password → catalogue. The suite runs with `ENV_FILE` pointed at a file that
  does not exist, so the fixture has to set this through the database like any
  other setting.

## Out of scope

- **A second test/live switch for payments.** §"Why this is not a test/live
  switch". The Stripe key is the mode.
- Per-reviewer share links, view counts, or expiry dates (§6).
- Basic auth at the platform edge. It is a legitimate alternative and it is one
  line of nginx, but it locks the admin out along with the storefront and it
  cannot be turned off from inside Beluga, which is where the merchant is
  standing when they decide to launch.
- Scheduling a launch, or a countdown page. A locked store shows a password
  form, not marketing.
- Separate staging data, a second database, or a way to reset a test catalogue
  before launch. Worth its own brief if anyone asks for it.
- Any change to what the server *sends* while locked. Order confirmations, cart
  recovery mail and outbound webhooks all keep firing — they are the wiring being
  tested, and suppressing them would make a locked store useless for the thing
  it exists to do.
