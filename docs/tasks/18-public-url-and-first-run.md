---
task: "18"
title: Setup asks for the public URL, and the URLs Beluga prints are true
status: todo
tier: 0
size: S
migration: none
blocked_by: []
blocks: []
touches: scripts/setup.ts · server/routes/setup.ts · shared/api.ts · src/admin/SetupPage.tsx · src/admin/DashboardPage.tsx
completed:
shipped_in:
summary: >-
  Neither setup path asks for `PUBLIC_URL`, so a store deployed straight from setup
  publishes a `sitemap.xml` and `robots.txt` full of `http://localhost:5173` links and
  sends Stripe buyers back to localhost after paying. The banners setup and the API print
  also say 5173 whether or not Vite got that port. Ask the question once, warn on the
  Overview when production is still pointing at localhost, and validate the admin email in
  the terminal the way the browser already does.
---

# 18 · Setup asks for the public URL, and the URLs Beluga prints are true

Found by running `npm run setup` in a clean clone, then `npm run build && npm
start`: `curl localhost:4000/sitemap.xml` listed `http://localhost:5173/shop`,
and `robots.txt` pointed crawlers at `http://localhost:5173/sitemap.xml`.
Nothing in the setup transcript or the "Ready" banner mentioned that a value
existed to set.

## The problem

`PUBLIC_URL` (`server/env.ts`) is the origin behind every absolute URL Beluga
writes: Stripe's `success_url` and `cancel_url` (`server/routes/checkout.ts`),
the sitemap and robots file (`server/routes/site.ts`), canonical and Open Graph
tags (`server/seo.ts`), and the links in every email — order confirmation,
password reset, staff invite, cart recovery. It defaults to
`http://localhost:5173`.

The CLI asks about the database and Stripe and stops. The browser wizard asks
for a store name, currency, administrator and look. Neither mentions the public
address, so a deploy that follows the README to the letter goes live with every
one of those URLs pointing at a developer's laptop. The failure is silent: pages
render, checkout reaches Stripe, and the buyer is sent to `localhost:5173/confirm`
after paying. The site plan already lists this as gotcha 16; this brief is the
fix rather than the warning.

Two smaller things from the same run:

- **Port 5173 was already taken.** Vite moved to 5174 without complaint, but the
  setup "Ready" banner, the API's "open …/setup" line (`server/index.ts`), and
  the default `PUBLIC_URL` all still said 5173. Everything worked through the
  proxy, so this is confusion rather than breakage, but it is the first thing a
  developer with another Vite project sees.
- **The CLI accepts any string as the administrator's email.** The wizard's
  `setupInputSchema` (`shared/api.ts:175`) uses `z.string().email()`; the
  terminal path (`scripts/setup.ts`, step 5) does not validate at all, so a typo
  becomes an account nobody can sign into and nothing will ever email.

## What to build

### 1 · The question

**`scripts/setup.ts`**, a new step between Stripe and the `.env` write:

```
4. Public address
────────────────────────
Where shoppers will reach the store. Stripe sends buyers back here after
paying, and every emailed link starts with it. Leave the default while
developing; set it before the store is public.

Public URL [http://localhost:5173]:
```

Validate with `new URL()`; refuse anything without `http:` or `https:`; write it
with `setEnvValue(lines, "PUBLIC_URL", …)`. Keep the same shape as the other
steps: an existing value is shown as the default and kept unless replaced.

**The browser wizard** does not write `.env`, so it cannot set the variable. It
can, however, tell the truth: `GET /api/setup` already returns `requiresToken`
while unconfigured; add `publicUrl` to that response and, on the final step,
show a one-line note when it is a localhost origin — *This server's `PUBLIC_URL`
is `http://localhost:5173`. Set it in the environment before the store is
public; Stripe and every emailed link use it.* Nothing else in the wizard
changes.

### 2 · The banner tells the truth

`vite.config.ts` reads `PORT` and falls back to 5173 without `strictPort`, so
Vite may bind somewhere else. Set `strictPort: true` so a taken port is an error
that names itself rather than a silent move — the README, the setup banner and
`PUBLIC_URL` all promise 5173, and a silent move makes all three wrong at once.
Then the "Ready" banner in `scripts/setup.ts` and the "open …/setup" line in
`server/index.ts` should print `PUBLIC_URL`, not a literal, so the three agree by
construction.

### 3 · The Overview says so in production

Add `publicUrl` to what `Wiring` (`src/admin/DashboardPage.tsx:254`) receives —
`/api/admin/environment` already returns it — and push a `warning` notice when
`NODE_ENV` is production and the origin's hostname is `localhost` or
`127.0.0.1`:

> **Public URL is localhost.** Stripe will send buyers back to
> `http://localhost:5173` after paying, and emailed links will not open. Set
> `PUBLIC_URL` to this store's real address and restart the API.

The environment endpoint needs to say whether it is production for that check;
add `production: boolean` to `environmentStatusSchema` (`shared/api.ts:220`)
rather than inferring it client-side.

### 4 · Validate the email in the terminal

In `scripts/setup.ts` step 5, loop until the answer parses with the same
`z.string().email().max(320)` the wizard uses. Import it from `shared/api.ts`
rather than writing a second regex; the two paths should refuse the same
strings.

## Out of scope

- A Settings field for the public URL. It is an environment value on purpose:
  it has to be right before the API boots, and a value in the database can be
  edited from a browser by anyone with an admin session.
- Detecting the public URL from request headers. `TRUST_PROXY` makes that a
  spoofing surface, and the site plan's deploy guides are the place to say
  "set it".

## Definition of done

Per `docs/tasks/README.md`, plus:

- `npm run setup` in a clean directory writes `PUBLIC_URL` to `.env` and refuses
  an email without an `@`.
- `server/setup-token.test.ts` or a sibling covers `publicUrl` in the
  unconfigured `GET /api/setup` response.
- A component test for `Wiring`: production plus a localhost origin renders the
  warning; development plus the same origin does not.
- `npm run dev` with 5173 taken exits with Vite's port error rather than
  starting on 5174.
- README "Getting started" mentions the public URL step in one sentence.
