# Docs site v2 — planning draft

Rough draft for iteration. Not a spec yet: the point is to argue about the shape
before anyone writes pages.

Scope assumption: tasks **14** (outbound webhooks) and **15** (catalogue CSV)
are shipped. Task **13** (digital products) is not, and is excluded — it gets a
page when it lands.

---

## 1. What changes, and why

The v1 site was seventeen pages aimed at a junior developer, in a friendly voice,
walking them from "here is a file tree" to "here is Heroku." That shape is wrong
now for three reasons.

**The reader changed.** A mid-level or senior developer does not need to be told
what `npm install` does, what a component is, or how to read a directory
listing. Roughly a third of v1's page count was that.

**The product changed.** v1 had no database, no sessions, no admin worth the
name, and modelled shipping as a magic Stripe SKU the browser picked. Half the
v1 pages describe machinery that no longer exists (`Setting up Gmail OAuth2` is
now one environment variable; `Creating a New Store` is now a wizard; `Advanced:
Custom Product Data` was superseded by real multi-axis variants).

**The failure mode changed.** v1's docs answered "how do I do this?" Our reader
will not ask us that — they will ask an AI, and get a decent answer, because
"add an Express route" is generic knowledge. What an AI *cannot* know is
Beluga's local rules: that money never comes from the request, that only the
webhook marks an order paid, that publishing is the only thing that writes to
Stripe, that a schema change lands in two dialects. Those are the things that,
when violated, produce code that compiles, passes review, and is wrong.

### The resulting principle

> **Document the constraints, not the keystrokes.**
> Every page should be mostly *why it works this way and what breaks if you
> assume otherwise*, with the how-to compressed to the shortest correct version.

Practical consequences:

- No step-by-step click-throughs where a labelled screenshot does the job.
- Every non-obvious decision states the trade and the rejected alternative. The
  README already does this well and is the tonal reference.
- Gotchas are not footnotes. They are the product.
- Prose can be dense. The reader can re-read, or paste it at an assistant.

### One idea worth deciding on early

Since we are assuming AI-assisted readers, make that a supported path rather
than a thing we shrug at:

- **`/llms.txt`** and a **`/docs/all.md`** — the entire docs set concatenated as
  one plain-text file, so a reader can drop it into a context window and ask
  questions against the real thing instead of a hallucinated Beluga.
- A **"Rules for contributors and agents"** page that is written to be pasted
  verbatim into an agent's instructions. Most of it exists already in
  `docs/tasks/README.md` under *The invariants*; it should be public.

This is cheap and I think it is the single highest-leverage thing on the list.

---

## 2. Proposed structure

Eight sections, ~26 pages. Marked **NEW** where there is no v1 equivalent.

### Start here
| Page | Notes |
| --- | --- |
| What Beluga is (and is not) | Self-hosted, Stripe-backed, SAQ-A, no marketplace, no app store, no live carrier rates. Set expectations in one screen. |
| Quickstart | `nvm use` → `npm install` → `npm run setup` → `npm run dev:all`. Under 20 lines. Ends at a running store with the demo catalogue. |
| Architecture | Replaces v1's *Project Structure*. The directory table from the README plus the one thing that matters: `shared/` is the contract, `src/lib/store-source.ts` is the seam. |
| **The invariants** **NEW** | The load-bearing rules. The paste-at-an-agent page described above. |

### Running a store
Merchant-facing. Someone operating the admin, who may not be the person who
deployed it.

| Page | v1 origin |
| --- | --- |
| Setup and settings | merges *Creating a New Store* + *Store Settings* |
| Theming | *Theming & Design*, largely intact |
| Products and variants | *Adding Products* + kills *Advanced: Custom Product Data* |
| Collections | *Adding Collections*, condensed |
| Images | **NEW** — derivatives, `srcset`, EXIF stripping |
| Pages | *Adding Pages*, but now a real feature: Markdown, server-rendered, reserved slugs |
| Search and sort | **NEW** |
| Orders and fulfilment | *Order Admin* |
| Staff accounts | **NEW** |
| Customer accounts | **NEW** |
| Abandoned cart recovery | **NEW** |

### Money
| Page | Notes |
| --- | --- |
| Stripe setup | Rewritten from *Setting up Stripe*. Checkout Sessions, not SKUs/Orders. |
| Checkout | Split out of v1's combined *Checkout & Shipping*. |
| **Shipping** | Own page. Outlined in §3. |
| Tax | **NEW** |
| Discount codes | **NEW** |
| Refunds and restocking | **NEW** |

### Integrating
| Page | Notes |
| --- | --- |
| **Outbound webhooks** | Two pages. Outlined in §4. |
| Stripe webhooks (inbound) | What Beluga consumes and why the redirect proves nothing. |
| Catalogue CSV | Task 15. Import/export, the validate-then-commit flow. |
| Order CSV export | Task 04. |
| The API | Route surface, auth, CSRF. Enough to build against. |

### Operating
| Page | Notes |
| --- | --- |
| Deploying | Replaces *Deploying to Heroku*. Generic + the persistence trap (§5). |
| Postgres | When and how to move off SQLite. |
| Email | Replaces *Email Templates* + deletes *Setting up Gmail OAuth2* entirely. |
| Environment reference | Every variable, one table. |
| SEO and link previews | *SEO and Social Media*, now mostly automatic. |

### Reference
| Page | Notes |
| --- | --- |
| **Gotchas** **NEW** | Cross-cutting. Raw material in §5. |
| Contributing | Task briefs, dual-dialect rule, `security.test.ts` requirement. |
| Roadmap and changelog | Replaces *Changelog & To Do's* — point at the generated `roadmap.html` rather than maintaining a second list. |

### What v1 pages die
`Setting up Gmail OAuth2` (one env var now), `Advanced: Custom Product Data`
(superseded by multi-axis variants), `Deploying to Heroku` (replaced, not
ported), `Setting up the Dev Environment` (absorbed into Quickstart —
it was mostly "install Node").

---

## 3. Shipping — section outline

This needs a proper page because it is the feature most likely to surprise
someone, and because the one existing document (`docs/shipping.md`) is
**design notes about live carrier rates we did not build** — useful, but not a
guide to what shipped. Those two should not be the same page.

**Proposed: `docs/shipping.md` becomes the appendix, and the guide is new.**

### 3.1 The model, in one diagram
Zones group countries. A zone naming no countries is the catch-all. Rates hang
off zones and are bounded by parcel weight and order subtotal. That is the whole
model, and "free over $50" and "heavy parcels cost more" are both just bounds.

Worth naming explicitly that these are **Beluga's rates, not Stripe shipping
rates** — the hosted checkout page is untouched.

### 3.2 The gotcha that gets its own heading
**The cart asks for the destination country before checkout.**

This looks like a UX mistake until you know why: Stripe's hosted Checkout
collects the address *after* the session exists, so a zone-priced store has to
know the destination before it can price postage. The session is then restricted
to that country, so a buyer cannot hold a domestic rate against an international
address — the same price-integrity rule as line items, applied to postage.

Anyone who reads the cart and thinks "I'll just move this to the Stripe page"
needs to hit this paragraph first.

### 3.3 Weight
Rates can be bounded by parcel weight, which comes from per-variant
`weight_grams`. **Open question for me to verify before writing:** what a store
with no weights recorded actually gets — I want to state the behaviour exactly,
because "some of my rates silently never match" is a miserable thing to debug.

### 3.4 Coverage gaps
`findCoverageGaps` exists, so the docs should teach the reader to use it: a
country in no zone, with no catch-all, cannot be checked out to. Include the
symptom as the reader will experience it, not just the concept.

### 3.5 Tax on postage
Rates carry their own tax behaviour, because postage is taxable in some
jurisdictions and not others. Short section, links to the tax page.

### 3.6 What we deliberately did not build
Live carrier rates, address validation, labels, tracking purchase. With the
actual reason — live rates require `ui_mode: 'elements'`, which means owning the
checkout page again and reversing the decision that deleted v1's custom checkout
and its bug cluster. Link to `docs/shipping.md` for the evidence and the
provider evaluation.

This section matters more than it looks: it is the answer to "why doesn't this
do what Shopify does," and answering it once in public saves the question
repeatedly.

### 3.7 Coming from v1
v1's flat-rate-shipping-as-a-Stripe-SKU had one price, no address awareness, no
international support. There is no migration path and there does not need to be
— say so plainly and move on.

---

## 4. Outbound webhooks — section outline

`docs/webhooks.md` is already 435 lines and genuinely good: payload examples per
event, verification in Node and Python, the raw-body trap, local testing, a
troubleshooting table. **I would not rewrite it.** It should become the
reference page nearly as-is.

What is missing is everything above it. Two pages:

### Page A — "Connect something" (new, short)
For the merchant or the integrator who has not decided to care yet.

- What this is *for*, concretely: fulfilment provider, accounting ledger,
  Zapier-style connector, internal Slack alert. This is the feature that
  substitutes for an app ecosystem, and nobody will work that out from a payload
  table.
- The six events as a table with one line each on *when it actually fires*
  (`order.updated` fires on carrier and tracking changes too — not obvious).
- Add an endpoint, copy the secret, send a test event, read the delivery log.
- **The secret is shown exactly once.** Own callout. Rolling it invalidates the
  old one immediately, so expect failures until the receiver is updated.

### Page B — "Build a receiver" (the existing doc, promoted)
Keep as-is, with additions:

- **Signature verification against the raw body, before JSON parsing.** Already
  covered; it should be impossible to miss. This is the number-one way a
  receiver gets written wrong, and an AI asked "verify this webhook" will
  cheerfully hand back code that verifies the re-serialised body.
- **At-least-once means idempotent.** Deduplicate on `beluga-event-id`.
- The retry schedule (1m, 5m, 25m, 2h, 10h, then given up) as a table, and the
  consequence: **five consecutive give-ups disables the endpoint**, and
  re-enabling clears the counter. Someone whose staging receiver was down over a
  weekend needs to find this.
- **Endpoints must be public HTTPS.** The hostname is resolved and refused if it
  lands on a private or reserved address — at creation *and* again before every
  send, redirects included. Say why: without it, admin access becomes a way to
  read the host's cloud metadata off `169.254.169.254`. Then
  `WEBHOOK_ALLOW_INSECURE_TARGETS=true` for a genuinely local receiver, with a
  clear "not in production."
- Delivery is a background pass every ten seconds, not inline. Explain the
  reason — a slow subscriber must not delay Beluga's response to Stripe, because
  that trips Stripe's own retry and re-enters the payment handler.

### Open question
Whether Page A and Page B stay separate or become one long page with a strong
table of contents. I lean separate: the audiences genuinely differ, and the
merchant-facing one should be readable in two minutes.

---

## 5. Gotchas — raw inventory

Not a page outline yet, just everything I found that will cost someone an hour.
Needs culling and sorting; some belong inline on their own page with only a
pointer here.

### Environment and dev loop
1. **Node 22 required.** Node 18 fails in ways that read as "command not found."
   `.nvmrc` exists; `nvm use` is the fix.
2. `npm run setup` writes `.env` **once and never touches it again.** Later
   changes are manual — people will expect re-running it to fix things.
3. **`SESSION_SECRET` is optional in development**, and without it a new one is
   generated per boot, so restarting the API signs you out. Reads as a session
   bug. Required in production.
4. Ports: Vite 5173, API 4000. **Avoid 5000 on macOS** — AirPlay Receiver binds
   it. (Already in `.env.example`; belongs in the docs too.)
5. `VITE_BELUGA_API=false` renders the bundled fixture with no database, which
   is the right answer for UI work and a confusing one if you set it and forget.

### Stripe
6. **The success redirect proves nothing.** Only the webhook marks an order
   paid. Anyone testing without `stripe listen` will conclude checkout is broken.
7. Local testing needs `stripe listen --forward-to
   localhost:4000/api/webhooks/stripe`, the printed `whsec_…` in `.env`, **and
   an API restart.** The restart is the step people skip.
8. **Stripe Prices are immutable.** Changing an amount mints a new Price and
   archives the old one. Not a bug, and the reason historic orders still resolve.
9. Same for `tax_behavior` — so changing how a store quotes prices only reaches
   Stripe when each product is **republished**, and **nothing republishes
   itself.** The overview lists what is stale.
10. **A product not published to Stripe cannot be bought.** Saving does not
    publish; that gate is deliberate.
11. **Test and live keys have separate catalogues.** Publishing under test keys
    does not put anything in the live account. v1's docs carried this warning for
    shipping SKUs; it is broader now.

### Deployment — the one that will actually bite
12. **SQLite is a file (`data/`) and uploaded images are files
    (`public/assets/`).** On any platform with an ephemeral filesystem, both
    vanish on redeploy. This is the single most expensive gotcha in the list and
    should be a callout on the deploy page, not a bullet: either attach a
    persistent volume, or move to Postgres *and* decide where images live.
13. `PUBLIC_URL` is used to build Stripe success and cancel URLs. Wrong value =
    buyers redirected somewhere wrong after paying.
14. **SEO head rewriting only runs in the production branch** — invisible under
    `npm run dev`, because Vite serves `index.html` untouched. Verify with
    `npm run build && npm start`, then curl the title.

### Silent-until-it-matters
15. **Email is a logged no-op until `SMTP_URL` is set.** Orders complete, no mail
    is sent, nothing errors. Deliberate — a store can take orders before email is
    wired — but silent.
16. **Tax is off by default, and under-collection is silent**: every order goes
    through, the buyer pays, the merchant owes the difference. Three things must
    be true in Stripe first (Tax activated, registrations recorded, tax codes on
    products) and none can be done from Beluga.
17. **Abandoned cart recovery is off by default**, and a guest's cart is never
    stored server-side, so there is nothing to remind them about by design.
18. **Customer orders link to an account only after email verification.** Not an
    oversight — skipping it would let anyone register with a stranger's address
    and read their order history.
19. **A partial refund does not restock.** It says nothing about which line came
    back. Full refund and cancellation do, guarded against double-restocking.
20. **`role` is recorded but gates nothing** — every administrator can do
    everything, and the docs should say so as loudly as the admin does.
21. **Removing a staff member destroys their sessions immediately**, which is
    most of the point.

### Contributing
22. **Every schema change lands in both dialects**, then `npm run db:generate`
    emits a migration for each. `db/dialect.test.ts` runs the same assertions
    against SQLite and Postgres.
23. **New routes go in `MUTATIONS` or `READS` in `server/security.test.ts`.**
    Not optional — that file is what stops an unprotected endpoint shipping.
24. **Money is integer cents everywhere.** CSV columns are `*_cents` for the same
    reason: a column of dollars in a spreadsheet is how floating-point money
    gets back in.
25. Storefront search is **client-side** against the `/api/store` snapshot,
    capped at `STORE_SNAPSHOT_LIMIT` (200). Past that, the swap is to
    `GET /api/products?search=`, behind `src/lib/store-source.ts`.
26. Image derivative naming lives in `shared/images.ts` because both sides use
    it, and **nothing type-checks that they agree** — drift is a 404 per image,
    not a compile error.
27. Reserved page slugs (`shop`, `cart`, `confirm`, `product`, `collection`,
    `about`, `admin`, `setup`) are refused, because a page at `/cart` would
    never load.

---

## 6. Open questions for you

1. **Merchant vs developer.** Right now I have them interleaved by topic
   (Shipping is one page serving both). The alternative is a hard split into two
   trees. Interleaving is less duplication; splitting is kinder to the merchant
   who does not care about `ui_mode`. I lean interleaved with clear "you only
   need this if you're building against Beluga" markers — but it is a real fork.
2. **How much of the README moves.** The README is currently doing a lot of the
   docs site's job, and doing it well. Do we (a) move that prose to the site and
   slim the README to a landing page, (b) duplicate and accept drift, or (c)
   generate parts of the site from the README? I lean (a).
3. **Screenshots.** v1 leaned on them heavily. They are the highest-maintenance
   content we can write and the admin is still moving. Propose: screenshots only
   where the UI is genuinely non-obvious (the shipping zone editor, the webhook
   delivery log), and nowhere else.
4. **The `llms.txt` / `all.md` idea in §1** — worth doing, or scope creep?
5. **Digital products (task 13)** is unbuilt. Do we leave a visible "not yet"
   placeholder, or say nothing until it ships? v1's changelog page set a
   precedent for being public about the gaps.
6. **Where the roadmap lives.** `docs/roadmap.html` is generated from task
   frontmatter and writes its own changelog. The site should link it, not
   reproduce it — confirm that is the call.
