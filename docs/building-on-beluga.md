# Building on Beluga: which files are yours to change

Beluga is a framework, not a product with an admin bolted on — the README
says as much, and invites you to build your own store on top of it. What it
does not say is which files that applies to. A fork's `src/` tree looks like
one undifferentiated pile of components, and it isn't: some of it is styling
that exists to be overwritten, some of it is a documented seam meant to be
extended in one direction, and some of it holds a rule from
[`docs/tasks/README.md`](tasks/README.md#the-invariants) that breaks silently
— not at compile time, not in review — when someone edits it as if it were
the first kind.

This page is the map. It doesn't repeat the invariants themselves; that list
is the source, and it stays in one place so it doesn't drift out of sync with
this one.

## 1 · Yours to replace

These files are presentation. Rewrite, restyle or delete them; nothing else
in the app depends on their internals, only on the data they're handed.

- [`src/pages/LandingPage.tsx`](../src/pages/LandingPage.tsx) — reads
  `store.hero` (heading, text, button, background image, all optional with a
  fallback to the store name and a **Shop everything** button), and
  `getFeaturedProducts` / `getVisibleCollections` from
  [`shared/catalog.ts`](../shared/catalog.ts) for the two sections below it.
  The collection tiles are inline here — there's no separate component to
  swap.
- [`src/components/layout/Banner.tsx`](../src/components/layout/Banner.tsx)
  and [`Footer.tsx`](../src/components/layout/Footer.tsx) — the header and
  footer. Both build their nav links from `store.pages` and
  `getVisibleCollections(store)`; the footer's worth reading once before you
  rewrite it, because it deliberately lists *every* published page whether or
  not it's in the header nav (`Banner` filters to `inNav`, `Footer` doesn't)
  — that's the only way a page a merchant publishes but forgets to add to the
  menu is still reachable from anywhere on the site.
- [`src/components/product/ProductCard.tsx`](../src/components/product/ProductCard.tsx)
  — purely presentational: a name, a preformatted price string, an image, a
  sold-out flag. It takes no `Product` and calls nothing from `shared/`, on
  purpose, so the theme editor can render a real-looking card without a
  catalogue behind it. [`ProductList.tsx`](../src/components/product/ProductList.tsx)
  is the thin layer above it that turns a `Product[]` and the store's
  currency/locale into those props via `formatPriceRange` and `isSoldOut`.
  Replace the card freely; if you replace the list too, keep it reading price
  and sold-out state from the catalogue rather than caching them, for the
  same reason as [§3](#3--not-without-reading-the-invariants).
- [`src/index.css`](../src/index.css) — the `--beluga-*` custom properties
  (`--beluga-ink`, `--beluga-primary`, `--beluga-radius`, and so on) are the
  baseline every component above is styled against, and they're also what
  **Settings → Look** overwrites at runtime for a merchant who never touches
  code. A replacement component should read colors and radius from these
  tokens rather than hard-coding values — otherwise it renders correctly
  until someone opens the theme editor, then quietly stops matching the rest
  of the store.
- [`emails/*.hbs`](../emails/) — `Ordered`, `Processing`, `Shipped`,
  `Refunded`, `AbandonedCart`, `VerifyEmail`, `ResetPassword`, each a
  `body.hbs` and `subject.hbs`, plus the shared `layout.hbs` and the
  `items.hbs` partial. Handlebars locals are pre-formatted display strings —
  see `toLocals` in [`server/email.ts`](../server/email.ts) — so a template
  does no arithmetic and can't get money wrong by rounding it twice.

## 2 · Extend through the seam

These are the places designed to be swapped for a different implementation
without touching a caller. Each one is a function or interface with an
existing example of exactly the substitution it exists for.

- **The catalogue's source** —
  [`loadStore`](../src/lib/store-source.ts) in `src/lib/store-source.ts`.
  Fetches `/api/store` and validates it with `storeSchema`; set
  `VITE_BELUGA_API=false` and it validates the same schema against
  `shared/demo-store.ts` instead. That's the worked example: Phase 2 swapped
  a database in behind this file and no component changed. Point it at a
  different backend by keeping the return type — `Promise<Store>`, schema-
  validated — the same.
- **Search and sort** — `searchProducts` / `sortProducts` in
  [`shared/catalog.ts`](../shared/catalog.ts), called client-side against the
  catalogue the storefront already has. The README documents the seam this
  sits behind: once a catalogue outgrows `STORE_SNAPSHOT_LIMIT`, the swap is
  to `GET /api/products?search=`, which already exists server-side, behind
  the same `src/lib/store-source.ts` file above.
- **Which email goes out when** — `templateForStatus` in
  [`server/email.ts`](../server/email.ts) maps an order status
  (`paid` / `processing` / `shipped` / `refunded`) to one of the templates in
  §1. Add a status and a matching `.hbs` pair, and it's picked up the next
  time an order transitions.
- **Where uploaded images live** — not a seam yet.
  [`server/uploads.ts`](../server/uploads.ts) writes directly to
  `ASSETS_ROOT` on the local filesystem today.
  [`docs/tasks/25-object-storage-for-images.md`](tasks/25-object-storage-for-images.md)
  is the brief for the `ImageStore` interface (`put` / `delete` /
  `publicUrl`) that will sit behind `storeImage` and `deleteImageFile`; once
  it lands, that's the file to extend for a different backend, and this
  section should gain its entry.

## 3 · Not without reading the invariants

These files look like the ones in §1 — components, a route handler — but
each one is the specific place a rule from
[the invariants list](tasks/README.md#the-invariants) is enforced. Read the
invariant before changing the logic here; the styling around it is still
yours.

- [`src/pages/CartPage.tsx`](../src/pages/CartPage.tsx) — the cart holds
  product/variant identifiers and quantities, never a price or an image URL.
  Every displayed price is re-derived from the current catalogue on render.
  This is what invariant 2 requires downstream at checkout — line items are
  built server-side from stored prices, never from anything the client sent
  — and it's enforced here first: if the cart cached a price, that's the
  value a stale tab would send back.
- [`src/pages/ConfirmPage.tsx`](../src/pages/ConfirmPage.tsx) — polls
  `GET /checkout/:sessionId` for order status rather than assuming payment
  succeeded because the buyer landed here. That's invariant 3: the success
  redirect proves nothing, only the webhook marks an order paid. A buyer who
  closes the tab before Stripe redirects them, or revisits this URL later,
  must not see a "thank you" for an order that never paid.
- [`src/components/product/ProductDetails.tsx`](../src/components/product/ProductDetails.tsx)
  — quantity is clamped through `normalizeQuantity` (in
  [`src/store/cart.ts`](../src/store/cart.ts)) on every change, including a
  re-clamp when switching variants, because a variant with less stock than
  the one just deselected must not keep a quantity that oversells it. Not
  one of the numbered invariants, but the same posture: the server
  re-validates stock at checkout regardless, so this exists to fail
  honestly in the UI rather than let someone add nine of something with
  five left and find out at payment.
- [`server/routes/checkout.ts`](../server/routes/checkout.ts) — builds
  Stripe line items from a loop that reads price, in cents, from the
  database for every id the client sent. This is invariants 1 and 2 at the
  one place money crosses into Stripe: skip the database read for a "quick"
  optimization and a client can name its own price.
- [`server/routes/webhook.ts`](../server/routes/webhook.ts) — the only
  place `paid`, `refunded` and cancellation states are written (invariant
  3), and it deduplicates events by id via `recordWebhookEvent` /
  `forgetWebhookEvent` in
  [`db/orders-repository.ts`](../db/orders-repository.ts), releasing the
  dedup record on a failed handler so Stripe's retry is actually processed
  (invariant 4). Add a new webhook handler here, not a new payment-state
  write anywhere else.
- **Anything under [`db/`](../db/)** — mainly invariant 6: `schema.sqlite.ts`
  and `schema.pg.ts` are edited together, then `npm run db:generate` emits a
  migration for each, and both are committed. `db/dialect.test.ts` runs the
  same assertions against both engines, so a query that only works on one of
  them fails there before it fails in production.

## 4 · Adding a field

The shortest correct path for a new field, worked through a concrete example
— a nullable `subtitle` on products — because most of what a fork does day
to day is exactly this, and skipping a step is how a field works in the admin
and silently 404s in the storefront, or types clean and fails at runtime on
Postgres only.

1. **Both dialect files.** Add the column to `products` in
   [`db/schema.sqlite.ts`](../db/schema.sqlite.ts) *and*
   [`db/schema.pg.ts`](../db/schema.pg.ts) — same name, same nullability, in
   the same commit. They're two files because SQLite and Postgres don't
   share a `drizzle-kit` dialect; nothing else forces them apart.
2. **`npm run db:generate`.** Emits a migration into each of
   `db/migrations/sqlite/` and `db/migrations/pg/`. Commit both — a
   migration for only one dialect is invariant 6 broken silently, since
   `npm test` seeds SQLite and won't notice Postgres never got the column.
3. **The zod schema in `shared/`.** Add `subtitle` to `productSchema` in
   [`shared/schema.ts`](../shared/schema.ts) — this is the type the
   storefront, the admin and the server all import, so this step is what
   makes a missing later step a type error instead of an `undefined` in
   production.
4. **The input schema in `shared/api.ts`.** Add it to the schema an admin
   write is validated against before it reaches the database — never inline
   validation in the route itself; see the Conventions section of
   [`docs/tasks/README.md`](tasks/README.md#conventions-to-match).
5. **The repository functions.** `buildProduct` in
   [`db/repository.ts`](../db/repository.ts) is where a database row becomes
   a `Product` — add the column to the read side there. `createProduct` /
   `updateProduct` in [`db/admin-repository.ts`](../db/admin-repository.ts)
   are the write side.
6. **The route.** The admin product route in
   [`server/routes/admin.ts`](../server/routes/admin.ts) already parses the
   body with the schema from step 4 and calls the repository function from
   step 5 — usually nothing changes here, which is the payoff of routes
   staying thin.
7. **The `security.test.ts` entry.** If this is a genuinely new route,
   add it to `MUTATIONS` or `READS` in
   [`server/security.test.ts`](../server/security.test.ts). For a field on
   an existing route, there's nothing to add — this step is here because
   it's the one that's easy to forget when it *does* apply, not because it
   always does.
8. **The editor.** Add the field to
   [`src/admin/ProductEditorPage.tsx`](../src/admin/ProductEditorPage.tsx),
   and to the storefront component from §1 that should display it, if any.

Steps 1–2 and 6–7 are each sometimes a no-op — a field that's read-only from
the storefront skips 6's route change, and one on an existing route skips 7
— but check, don't assume: skipping step 2 for a field that turns out to
matter on Postgres is exactly invariant 6's failure mode.
