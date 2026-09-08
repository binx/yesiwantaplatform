# Docs site v2 — planning draft

Working document, kept alongside `roadmap.html`. Not a spec: the point is to
argue about the shape before anyone writes pages.

**Revision 4** — the §7.2 build blocker is fixed in code (server compiles to
JS), `engines` reconciled, and DigitalOcean assessed: Droplet in, App Platform
out. Task 13's scope question is closed.

*Revision 3 — deploying promoted to section 2 and investigated against the
source (§7).*

*Revision 2 — reframed around a single audience (§1), digital products added
(§4), shipping's open question resolved against the code (§3).*

---

## 1. Who this is for, and what follows from it

**One reader, not two.** The merchant and the developer are the same person: a
developer who wants to build a custom store on top of Beluga. Running this
requires dev skills and always will.

That is a stronger claim than "no beginners," and it changes the docs more than
the earlier draft assumed. Three consequences:

**Beluga is a framework, not a product with an admin bolted on.** The v1 site
was organised as a product manual — *Adding Products*, *Order Admin*, *Store
Settings* — pages that describe screens. For someone building on top, the screen
is the least interesting layer. The data model, the API behind it, and the seams
they are expected to cut along are the interesting layers. Pages should be
organised by **capability**, and each one should answer "what is the model, what
is the API, what may I change" — with the admin UI as one consumer of that,
not the subject.

**No hand-holding, and no click-throughs.** No `npm install` explanations, no
numbered screenshot tours. A labelled screenshot where the UI is genuinely
non-obvious; otherwise prose.

**Document the constraints, not the keystrokes.** Our reader will not ask us how
to add an Express route — they will ask an AI and get a fine answer, because
that is generic knowledge. What no assistant can know is Beluga's local rules:
money never comes from the request, only the webhook marks an order paid,
publishing is the only thing that writes to Stripe, a schema change lands in two
dialects. Those are the rules that, when violated, produce code that compiles,
passes review, and is wrong.

So every page is mostly *why it works this way and what breaks if you assume
otherwise*, with the how-to compressed to the shortest correct version. The
README is the tonal reference — it already does this.

### Confirmed: ship an AI-readable build of the docs

Since the reader is assumed to be working with an assistant, make that a
supported path rather than something we tolerate.

- **`/docs/all.md`** — every page concatenated into one plain-text file with
  stable headings, so a reader can drop the whole thing into a context window
  and ask questions against the real Beluga instead of a hallucinated one.
  Generated at build time from the same sources as the site; never hand-maintained.
- **`/llms.txt`** — the conventional discovery file: what Beluga is, the
  invariants in brief, and a link to `all.md` and the key pages.
- **The invariants page written to be pasted verbatim** into an agent's
  instructions or a `CLAUDE.md`. Most of it exists in `docs/tasks/README.md`
  under *The invariants*; it deserves to be public and quotable.

The generation should reuse the `npm run roadmap` pattern — a script, validated,
committed — so the AI build cannot drift from the site.

---

## 2. Proposed structure

Nine sections, ~40 pages. **NEW** marks pages with no v1 equivalent.

That is more than double v1's seventeen, which is worth a moment's suspicion.
It is not padding — v1 had no database, no accounts, no tax, no zones, no
webhooks, and no deploy story worth the name. But if it feels too big, the
honest consolidations are *Money and fulfilment* (eight pages, several short)
and *The catalogue* (seven). The ordering below is the sequence a forker
actually moves through: understand it → get it running somewhere → make it
yours → fill it with things → take money.

### Start here
| Page | Notes |
| --- | --- |
| What Beluga is (and is not) | Stripe-backed, SAQ-A. Not a marketplace, no app store, no live carrier rates. Says plainly that you are expected to write code — **and that there is no hosted Beluga. You host it yourself, always.** That belongs in the first screen, not discovered at deploy time. |
| Quickstart | `nvm use` → `npm install` → `npm run setup` → `npm run dev:all`. Under 20 lines, ends at a running store with the demo catalogue. |
| Architecture | Replaces v1's *Project Structure*. Directory table, then the parts that matter to someone building on top: `shared/` is the contract validated on both sides, `src/lib/store-source.ts` is the seam. |
| **The invariants** **NEW** | The load-bearing rules. Written to be pasted at an agent. |

### Deploying **NEW SECTION — and it comes second**
There is no hosted Beluga, so every reader deploys before they have a store to
build out. v1 buried this as the second-to-last page, aimed at a junior
developer, on a platform that no longer suits the app. It is now the step
between "I forked it" and everything else, and it belongs here.

| Page | Notes |
| --- | --- |
| **Deploying: the shape** **NEW** | What a Beluga deployment *is* — one Node process serving API and static, what must persist, what breaks if it doesn't. Platform-agnostic. See §7. |
| **Deploy to Fly.io** **NEW** | Dockerfile + volume; SQLite. Replaces *Deploying to Heroku*. |
| **Deploy to a DigitalOcean Droplet** **NEW** | A normal VM. Real filesystem, optional managed Postgres. |
| **Going live** **NEW** | Test keys → live keys, pointing Stripe's webhook at the deployed URL, the pre-launch checklist. The step most likely to be got wrong. |

### Building on Beluga **NEW SECTION**
The section v1 had no equivalent of, and the one this audience actually came
for. Currently the answer to "how do I customise this?" lives in scattered
README asides and source comments.

| Page | Notes |
| --- | --- |
| **The seams** **NEW** | Where you are meant to cut. `store-source.ts`, the `shared/` contract, theming vs forking the storefront, what is safe to replace and what is load-bearing. |
| **Adding a field** **NEW** | End-to-end worked example: both dialect schemas → `db:generate` → repository → zod schema in `shared/` → route → admin form. The one walkthrough worth writing, because it crosses every convention at once. |
| **Adding a route** **NEW** | Thin-route convention, `requireAdmin` + `verifyCsrf` on the whole router, `httpError`/`toHttp`, and the `security.test.ts` registration that is not optional. |
| **The API** **NEW** | Route surface, auth, CSRF, the public `/api/store` snapshot and its 200-product cap. |
| Theming | *Theming & Design*, kept — but rewritten as "theme tokens vs. forking components." |

### The catalogue
| Page | v1 origin |
| --- | --- |
| Products, variants and options | *Adding Products*; retires *Advanced: Custom Product Data* |
| **Digital products** **NEW** | Task 13. Writable now; grows a delivery section if delivery is ever built — see §4 |
| Collections | *Adding Collections*, condensed |
| Images | **NEW** — derivatives, `srcset`, EXIF stripping, the naming contract |
| Pages | *Adding Pages*, now a real feature: Markdown, server-rendered, reserved slugs |
| Search and sort | **NEW** — and why it is client-side |
| Catalogue CSV | **NEW** — task 15, the validate-then-commit flow |

### Money and fulfilment
| Page | Notes |
| --- | --- |
| Stripe setup | Rewritten from *Setting up Stripe*: Checkout Sessions, not the dead SKUs/Orders APIs |
| Checkout | Split out of v1's combined *Checkout & Shipping* |
| **Shipping** | Own page. Outlined in §3. |
| Tax | **NEW** |
| Discount codes | **NEW** |
| Orders and fulfilment | *Order Admin*, reframed around the order model |
| Refunds and restocking | **NEW** |
| Order CSV export | **NEW** — task 04 |

### Accounts
| Page | Notes |
| --- | --- |
| Staff accounts | **NEW** |
| Customer accounts | **NEW** — and the verification gate |
| Abandoned cart recovery | **NEW** |

### Integrating
| Page | Notes |
| --- | --- |
| **Outbound webhooks** | Two pages. Outlined in §5. |
| Stripe webhooks (inbound) | What Beluga consumes, and why the success redirect proves nothing |

### Operating
| Page | Notes |
| --- | --- |
| Postgres | When and how to move off SQLite |
| **Backups and restore** **NEW** | Falls out of §7: the volume holds the store. Nobody else is backing it up. |
| Email | Replaces *Email Templates*; deletes *Setting up Gmail OAuth2* entirely |
| Environment reference | Every variable, one table |
| SEO and link previews | *SEO and Social Media*, now mostly automatic |

### Reference
| Page | Notes |
| --- | --- |
| **Gotchas** **NEW** | Cross-cutting. Raw material in §6. |
| Contributing | Task briefs, dual-dialect rule, the `security.test.ts` requirement |
| Roadmap and changelog | Link the generated `roadmap.html`; do not maintain a second list |

### What dies
`Setting up Gmail OAuth2` (one env var now), `Advanced: Custom Product Data`
(superseded by multi-axis variants), `Deploying to Heroku` (replaced, not
ported), `Setting up the Dev Environment` (absorbed into Quickstart).

---

## 3. Shipping — section outline

Needs a real guide, because the only existing document (`docs/shipping.md`) is
**design notes about live carrier rates we did not build**. Valuable, but not a
guide to what shipped. Proposal: that file becomes the appendix, and the guide
is new.

Reading `shared/shipping.ts` closely resolved the open question from revision 1
and turned up more than expected. The whole model is about 200 lines and almost
every decision in it is a documentable trap.

### 3.1 The model
Zones group countries; a zone naming no countries is the catch-all. Rates hang
off zones, bounded by parcel weight and parcel subtotal. "Free over $50" and
"heavy parcels cost more" are both just bounds. These are **Beluga's rates, not
Stripe shipping rates** — the hosted checkout page is untouched.

Two behaviours to state up front:

- **An unpinned rate (no zone) applies everywhere.** This is what lets a
  flat-rate store work with no zones configured at all — worth leading with,
  since it is the simplest useful configuration and reads as an edge case in the
  schema.
- **Every matching rate is offered, cheapest first.** Not one winner. That is
  what a standard/express pair needs.

### 3.2 The gotcha that gets its own heading
**The cart asks for the destination country before checkout.**

Looks like a UX mistake until you know why: hosted Checkout collects the address
*after* the session exists, so a zone-priced store must know the destination
before it can price postage. The session is then restricted to that country, so
a buyer cannot hold a domestic rate against an international address — the
line-item price-integrity rule, applied to postage.

Anyone who reads the cart and thinks "I'll move this to the Stripe page" needs
to hit this paragraph first.

### 3.3 Silent failure — the section that justifies the page
Three ways shipping goes wrong without erroring. `findCoverageGaps` exists
precisely because they are invisible, so the docs should teach it as a routine
check, not a curiosity.

1. **A coverage gap ships free.** When no rate matches, the buyer is offered
   nothing and pays no postage. The order still completes. Deliberate —
   inventing a price would be worse — but it means a misconfiguration is
   discovered when a parcel arrives with no postage on it.
2. **A store with no recorded weights reports a 0 g parcel**, which matches the
   lightest weight band. So weight bounds configured before variant weights are
   filled in do not fail closed; everything quietly qualifies for the cheapest
   band. *(This was the open question in revision 1. Answered.)*
3. **Subtotal bounds count physical lines only.** A $40 download in the cart does
   not push a $10 box over a free-shipping threshold. The upper bound is nastier
   — without this rule a digital-heavy cart sails past every band's ceiling,
   matches nothing, and ships free.

### 3.4 Digital lines are excluded, not zeroed
Worth its own heading because the reasoning generalises to anything anyone adds
later. Giving a download `weightGrams: 0` looks equivalent and is not: a
zero-gram line still *participates*, so a cart of nothing but PDFs reports a 0 g
parcel, matches the lightest band, and charges the buyer postage on a parcel
that does not exist. `physicalLines` / `requiresShipping` are the API; a cart
with no physical line collects no address at all.

### 3.5 Tax on postage
Rates carry their own tax behaviour, because postage is taxable in some
jurisdictions and not others. Short, links to the tax page.

### 3.6 What we deliberately did not build
Live carrier rates, address validation, label purchase, tracking. With the
reason: live rates require `ui_mode: 'elements'`, which means owning the
checkout page again and reversing the decision that deleted v1's custom checkout
and its bug cluster. Link `docs/shipping.md` for the evidence and the provider
evaluation.

This is the answer to "why doesn't this do what Shopify does," and answering it
once in public saves the question repeatedly.

### 3.7 Coming from v1
Flat-rate-shipping-as-a-Stripe-SKU had one price, no address awareness, no
international support. No migration path, and none needed. Say so and move on.

---

## 4. Digital products — resolved

Resolved while I was working: `main` has since split the feature in two
(commit `ad261af`, *Split digital delivery out of task 13 into task 16*).

- **Task 13 — done, and correctly scoped.** It "teaches the cart what a download
  is": `products.kind` splits physical from digital, shipping excludes digital
  lines (`physicalLines`, `requiresShipping`, `parcelFor` in
  `shared/shipping.ts`), and checkout skips address collection when no physical
  line is present (`server/routes/checkout.ts:92`). `migration: one column`.
- **Digital delivery — a known gap, not a queued task.** Entitlements, expiring
  signed URLs, and file storage outside the statically-served upload directory.
  The approach has not been chosen, so it sits in
  [docs/gaps/digital-delivery.md](gaps/digital-delivery.md) rather than in
  `docs/tasks/` — it was briefly numbered task 16, which is why the commit
  history and the note above still say so.

That closes the discrepancy I flagged in revision 2 — the tracker was briefly
overstating task 13 against its own brief, and someone fixed it properly by
splitting the work rather than by editing a status.

**Consequence for the docs:** the *Digital products* page can be written now,
scoped to "how to sell a non-shippable item" — the catalogue flag, the shipping
consequences, and the fact that **delivering the file is currently your job**
(an outbound `order.paid` webhook into your own fulfilment is the obvious
route, and worth saying explicitly since it is the first genuinely useful thing
outbound webhooks unlock). The page then grows a delivery section when 16 lands.

§3.4 stands on its own regardless — that behaviour is shipped and correct.

---

## 5. Outbound webhooks — section outline

`docs/webhooks.md` is already 435 lines and good: payload examples per event,
verification in Node and Python, the raw-body trap, local testing, a
troubleshooting table. **Do not rewrite it.** Promote it as the reference.

What is missing is everything above it. Two pages — I lean strongly toward
keeping them separate even with a single audience, because the entry points
differ: "should I use this at all" and "my signature check fails" are different
moments.

### Page A — "Connect something" (new, short)
- What it is *for*, concretely: fulfilment provider, accounting ledger,
  Zapier-style connector, internal alerting. **This is the feature that
  substitutes for an app ecosystem** — nobody derives that from a payload table,
  and for a reader deciding whether to build on Beluga it is a selling point.
- The six events, one line each on *when they actually fire*. `order.updated`
  covers carrier and tracking changes too, which is not obvious.
- Add an endpoint, copy the secret, send a test event, read the delivery log.
- **The secret is shown exactly once.** Own callout. Rolling it invalidates the
  old one immediately — expect failures until the receiver has the new one.

### Page B — "Build a receiver" (existing doc, promoted)
Keep as-is, plus:

- **Verify against the raw body, before JSON parsing.** Already covered; make it
  impossible to miss. This is the top way a receiver gets written wrong, and an
  assistant asked to "verify this webhook" will happily produce code that
  verifies the re-serialised body — which passes in testing and fails on the
  first payload with different key ordering.
- **At-least-once means idempotent.** Deduplicate on `beluga-event-id`.
- Retry schedule as a table (1m, 5m, 25m, 2h, 10h, then given up), and the
  consequence: **five consecutive give-ups disables the endpoint**; re-enabling
  clears the counter. Someone whose staging receiver was down over a weekend
  needs to find this.
- **Endpoints must be public HTTPS.** The hostname is resolved and refused if it
  lands on a private or reserved address — at creation *and* before every send,
  redirects included. Say why: otherwise admin access becomes a way to read the
  host's cloud metadata off `169.254.169.254`. Then
  `WEBHOOK_ALLOW_INSECURE_TARGETS=true` for a genuinely local receiver, with an
  unambiguous "not in production."
- Delivery is a background pass every ten seconds, never inline. The reason
  matters: a slow subscriber must not delay Beluga's response to Stripe, because
  that trips Stripe's own retry and re-enters the payment handler.

---

## 6. Gotchas — raw inventory

Everything found so far that will cost someone an hour. Needs culling and
sorting; many belong inline on their own page with only a pointer here.

### Environment and dev loop
1. **Node 22 required.** Node 18 fails in ways that read as "command not found."
   `.nvmrc` exists; `nvm use` is the fix.
2. `npm run setup` writes `.env` **once and never touches it again.** People will
   expect re-running it to fix things.
3. **`SESSION_SECRET` is optional in development**, and without it a fresh one is
   generated per boot — so restarting the API signs you out. Reads as a session
   bug. Required in production.
4. Ports: Vite 5173, API 4000. **Avoid 5000 on macOS** — AirPlay Receiver binds it.
5. `VITE_BELUGA_API=false` renders the bundled fixture with no database. Right
   answer for UI work, confusing if you set it and forget.
6. **A fresh checkout has no store in it.** `npm test` seeds per suite, but
   `npm run test:e2e` drives the real app against `data/beluga.sqlite`; in a new
   clone or worktree the whole suite fails on a missing heading, which reads as a
   broken storefront and is an empty database. `npm run db:migrate && npm run
   db:seed` once per checkout.
7. **`.env` is irrelevant to e2e** — `playwright.config.ts` points `ENV_FILE` at
   a file that does not exist, deliberately. Copying a `.env` in will not fix a
   failing run.
8. **Postgres skips silently** in `db/dialect.test.ts` if `embedded-postgres`
   cannot start, so a green run is *not* proof both dialects passed. Confirm with
   `--reporter=verbose` and look for `repository on postgres`.

### Stripe
9. **The success redirect proves nothing.** Only the webhook marks an order paid.
   Anyone testing without `stripe listen` concludes checkout is broken.
10. Local testing needs `stripe listen --forward-to
    localhost:4000/api/webhooks/stripe`, the printed `whsec_…` in `.env`, **and
    an API restart.** The restart is the step people skip.
11. **Stripe Prices are immutable.** Changing an amount mints a new Price and
    archives the old one. Not a bug — it is why historic orders still resolve.
12. Same for `tax_behavior`, so changing how a store quotes prices reaches Stripe
    only when each product is **republished**, and **nothing republishes itself.**
    The overview lists what is stale.
13. **A product not published to Stripe cannot be bought.** Saving does not
    publish; the gate is deliberate.
14. **Test and live keys have separate catalogues.** Publishing under test keys
    puts nothing in the live account.

### Deployment — the expensive one
15. **SQLite is a file (`data/`) and uploaded images are files
    (`public/assets/`).** On any platform with an ephemeral filesystem, both
    vanish on redeploy. Biggest trap in the list; deserves a callout on the
    deploy page, not a bullet. Either attach a persistent volume, or move to
    Postgres *and* decide where images live.
16. `PUBLIC_URL` builds Stripe success and cancel URLs. Wrong value = buyers
    redirected somewhere wrong after paying.
17. **SEO head rewriting runs only in the production branch** — invisible under
    `npm run dev`, because Vite serves `index.html` untouched. Verify with
    `npm run build && npm start`, then curl the title.

### Silent until it matters
18. **Email is a logged no-op until `SMTP_URL` is set.** Orders complete, no mail
    sent, nothing errors. Deliberate, so a store can take orders before email is
    wired — but silent.
19. **Tax is off by default and under-collection is silent**: every order goes
    through, the buyer pays, the merchant owes the difference. Three things must
    be true in Stripe first (Tax activated, registrations recorded, tax codes on
    products), none doable from Beluga.
20. **Shipping fails silently three ways** — see §3.3. Coverage gap ships free;
    no recorded weights means everything matches the lightest band; subtotal
    bounds ignore digital lines.
21. **Abandoned cart recovery is off by default**, and a guest's cart is never
    stored server-side, so there is nothing to remind them about by design.
22. **Customer orders link to an account only after email verification.** Not an
    oversight — skipping it would let anyone register with a stranger's address
    and read their order history.
23. **A partial refund does not restock.** It says nothing about which line came
    back. Full refunds and cancellations do, guarded against double-restocking.
24. **`role` is recorded but gates nothing** — every administrator can do
    everything. The docs should say so as loudly as the admin does.
25. **Removing a staff member destroys their sessions immediately**, which is
    most of the point.

### Building on it
26. **Every schema change lands in both dialects**, then `npm run db:generate`
    emits a migration for each. `db/dialect.test.ts` asserts against both.
27. **New routes go in `MUTATIONS` or `READS` in `server/security.test.ts`.** Not
    optional — that file is what stops an unprotected endpoint shipping.
28. **Money is integer cents everywhere.** CSV columns are `*_cents` for the same
    reason: a column of dollars in a spreadsheet is how floating-point money gets
    back in.
29. Storefront search is **client-side** against the `/api/store` snapshot,
    capped at `STORE_SNAPSHOT_LIMIT` (200). Past that, swap to
    `GET /api/products?search=` behind `src/lib/store-source.ts`.
30. Image derivative naming lives in `shared/images.ts` because both sides use
    it, and **nothing type-checks that they agree** — drift is a 404 per image,
    not a compile error.
31. Reserved page slugs (`shop`, `cart`, `confirm`, `product`, `collection`,
    `about`, `admin`, `setup`) are refused, because a page at `/cart` would never
    load.
32. `variantName` and `aboutText` are **deprecated but still present**, kept one
    release for rollback. Someone reading the schema will otherwise use them.

---

## 7. Deploying — investigation

You want people to fork, modify, and deploy. I read the build and boot path to
see what that actually takes. **Nothing here has been deployed and tested — this
is a source read**, and it turned up one thing that has to be fixed in code
before a deploy guide can be written truthfully.

### 7.1 The shape of a deployment
Better than expected. In production the Express app serves the built client from
`dist` and uploads from `public/assets` (`server/app.ts:90,99–105`), so a
deployment is **one Node process on one port** — no separate static host, no
CDN required, no reverse proxy needed to get started.

**Migrations run automatically on boot** (`runMigrations()` in
`server/index.ts`), are idempotent, and the two data backfills are written to be
no-ops on a database that has had them. So there is no release-phase step to
configure — a real simplification over v1's Heroku instructions. Roll one
instance at a time rather than booting several into an unmigrated database.

### 7.2 The blocker — fixed
**Was:** `npm start` ran `tsx server/index.ts` with `tsx` in devDependencies, and
`tsconfig.server.json` set `"noEmit": true`, so the server was never compiled.
`npm ci --omit=dev && npm run build && npm start` could not work, and the only
shape that ran shipped the whole dev toolchain in the image.

**Now:** the server compiles to real JavaScript (option 2).

- `tsconfig.server.build.json` — extends the existing server config, drops the
  test files, and emits to `dist-server/`. Kept **out** of the root project
  references on purpose: two projects including the same files confuse `tsc -b`.
- `build` is `tsc -b && tsc -p tsconfig.server.build.json && vite build`. The
  first pass still typechecks everything *including the tests*; the second emits
  only what production runs.
- `start` is `node dist-server/server/index.js`. No TypeScript at runtime.

It went in cleanly because the codebase was already shaped for it: `"type":
"module"` plus imports that already carry `.js` specifiers is exactly what
NodeNext emit wants, so nothing had to be rewritten.

Verified: build passes, the compiled server boots under plain `node`, runs its
migrations, serves the storefront (200) and correctly answers 503 from
`/api/store` for an unconfigured store. Typecheck and lint pass, 511 tests pass,
and nothing in `dist-server/` imports a devDependency — so a production image can
prune to `dependencies` after building.

**The deploy shape this unlocks**, which both guides now share:

```
install all deps  →  npm run build  →  prune to production  →  node dist-server/server/index.js
```

In Docker that is the ordinary two-stage build. The only subtlety is that the
runtime stage still needs `db/migrations/` and the built `dist/` present, and
must start from the repo root — see 7.3.

### 7.3 Things that constrain the platform choice
- **Images have no object-storage adapter.** `ASSETS_ROOT` is hardcoded to
  `path.resolve("public/assets")` (`server/uploads.ts:22`) with no env override.
  So uploaded images *must* live on a persistent filesystem today. This is what
  actually rules platforms in and out, more than the database does.
- **Paths are resolved from the working directory** — `public/assets`, `dist`,
  and `./db/migrations/*` are all relative. The process must start from the repo
  root, and **the migrations folder must be present in the deployed image**; a
  build that prunes source files breaks boot, not just uploads.
- **Native modules**: `better-sqlite3` and `sharp`. Both need a build toolchain
  or prebuilt binaries — relevant to Alpine/musl base images and to ARM builders.
- **`engines` now says `node >=22`** (was `>=20.19`, contradicting `.nvmrc` and
  the README). Platforms auto-detect from `engines`, so the old value could have
  provisioned Node 20 and produced a confusing first deploy. Fixed.
- Sessions are in the database, and the background timers (webhook delivery,
  cart reminders) are guarded by conditional updates, so **multiple instances are
  safe on Postgres**. On SQLite-with-a-volume they are not, because the volume
  attaches to one machine.

### 7.4 Recommended: two guides, deliberately different
The two axes a forker chooses between are *cheap and simple* vs *scales and
survives*. Pick one platform for each rather than two that look alike.

**Fly.io — SQLite on a persistent volume.** One machine, one volume mounted for
both the database and `public/assets`, a Dockerfile you control (which handles
the native modules and the Node version explicitly). This is the honest
expression of Beluga's default: a store that runs without provisioning anything.
Cheap, genuinely simple, and the constraint is stated plainly — one machine, so
scale up rather than out, and back the volume up.

**DigitalOcean Droplet — a normal server.** A VM with a real filesystem, so both
SQLite and the image directory simply work with no volume gymnastics. Pair it
with DO Managed Postgres when the store outgrows one box. The cost is that you
own the process manager, TLS and OS updates — which some people actively want,
and which makes it a genuinely different guide rather than a second PaaS.

**On DigitalOcean specifically** (you asked whether they'd fallen off): no. They
are healthy, and Managed Postgres and Spaces are solid. But the *managed* product
is the wrong shape for Beluga: **App Platform does not support block storage
volumes.** Per DO's own documentation the container filesystem is ephemeral,
wiped on every deploy and container replacement, and capped at 4 GiB — so
uploaded product images would vanish on each deploy, exactly the Heroku failure.
Their guidance is to use Spaces (S3-compatible) instead, which Beluga cannot do
until there is an object-storage adapter (§8.4). So: **Droplet yes, App Platform
no**, and that distinction is worth stating in the guide because "I'll use the
managed one, it's easier" is the natural instinct and it silently eats the
catalogue's images.

Sources: [How to Store Data in App Platform](https://docs.digitalocean.com/products/app-platform/how-to/store-data/) ·
[Allow App Platform apps to use block storage volumes](https://ideas.digitalocean.com/app-platform/p/allow-app-platform-apps-to-use-block-storage-volumes) ·
[Why are large files failing to upload](https://docs.digitalocean.com/support/why-are-large-files-failing-to-upload-to-my-app-on-app-platform/)

**Explicitly ruled out, with reasons** (this is useful content, not filler):
- **Heroku** — ephemeral filesystem, no volumes. The v1 guide's platform is now
  the wrong answer, and saying why teaches the persistence constraint better than
  any amount of prose.
- **DigitalOcean App Platform** — as above.
- **Vercel / Netlify** — serverless functions, no persistent disk, no long-lived
  process for the background delivery timers. Not a fit for this app.
- **Railway and Render** both work (volumes, managed Postgres); name them as
  known-workable rather than writing a third and fourth guide.

Every entry on that list fails for the *same* reason, which is the strongest
argument for making "what must persist" the first deploy page rather than a
footnote in each guide.

### 7.5 What each guide contains
Same skeleton both times, so they can be diffed:
fork and configure → build → provision storage → environment variables →
first deploy → run setup → point Stripe's webhook at the deployed URL → verify
(a real test payment, and `curl` the rewritten `<title>` to confirm the
production branch is live) → back up → redeploy and roll forward.

The Stripe webhook step is the one most likely to be got wrong, because it is the
only step that requires going back to a third-party dashboard after the deploy
succeeds — and until it is done, orders will never be marked paid while
everything *looks* fine.

### 7.6 Order of work
1. ~~Decide 7.2.~~ Done — the server compiles to JS.
2. ~~Reconcile the `engines` / `.nvmrc` mismatch.~~ Done — `engines` says `>=22`.
3. **Next:** an `ASSETS_DIR` env override, so the image directory can be pointed
   at a mounted volume without a symlink. Small, and the prerequisite for object
   storage later. Not done — it changes upload path handling, which is
   security-sensitive (the traversal guards in `server/uploads.ts` are written
   against `ASSETS_ROOT`), so it wants its own change and its own test rather
   than being folded into a build fix.
4. Then write the two guides against deploys that have actually been run.

---

## 8. Open questions

**Resolved in this revision:** single audience (§1); AI-readable build confirmed
(§1); shipping weight behaviour answered from source (§3.3).

**Deferred until the codebase is finished:**
- How much of the README moves to the site vs. stays vs. is generated from a
  shared source. The README is currently doing much of the site's job well.
- Screenshot policy — how many, and where. The admin is still moving, and
  screenshots are the highest-maintenance content we can write.

**Also resolved:** section order — deploy comes before store-building, since
there is no hosted Beluga and a forker must deploy before there is a store to
build out. *Deploying* is now section 2 and *Building on Beluga* third.

**Also resolved:** the build blocker (§7.2, fixed in code), the `engines`
mismatch (fixed), digital products scope (§4, split into task 16), and the
platform shortlist (§7.4 — Fly.io and a DigitalOcean Droplet).

**Still open:**
1. **`ASSETS_DIR` env override** — §7.6 step 3. The next code change, and the one
   that makes both deploy guides cleaner. Security-sensitive, so it wants its own
   change rather than riding along with a build fix.
2. **Where the site lives** — same repo and generated alongside `roadmap.html`,
   or separate? Generating from this repo is the only way `all.md` and the
   invariants page stay honest, which argues for same-repo.
3. **Object storage for images.** Not needed for either guide, but its absence is
   what forces a volume onto every deployment including Postgres ones — and it is
   the single thing standing between Beluga and the whole class of managed
   platforms (App Platform, Heroku, Render's free tier). Worth its own task brief.
4. **Whether the guides get built and run before they are written.** I'd argue
   yes — §7 was a source read that turned up a blocker no amount of reading the
   docs would have found, and a deploy guide written from inference will have the
   same class of error.
