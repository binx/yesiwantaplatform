---
task: "08"
title: Store pages
status: todo
tier: 1
size: M
migration: one table
blocked_by: []
blocks: []
touches: db/schema.*.ts · src/router.tsx · src/admin/useAutosave.ts
completed: 
shipped_in: 
summary: >-
  The store has exactly one editable page, and it's a single `aboutText` blob on the
  settings row. A merchant can't publish a returns policy — which several payment and
  consumer-protection regimes expect them to have — without editing React. A `pages` table
  with slug, title and body, one storefront route and a nav toggle covers it; the editor
  can reuse the autosaving form pattern from the product editor.
---

# 08 · Store pages

## The problem

A Beluga store has exactly one editable page of prose: `aboutText`, a single
column on the settings row (`db/schema.sqlite.ts:29`), rendered by
`src/pages/AboutPage.tsx` and linked from the banner when non-empty. There is no
way to publish a returns policy, shipping information, terms, or a contact page
without editing React and redeploying.

This is not cosmetic. Consumer-protection rules in several jurisdictions, and
Stripe's own account requirements, expect a store to publish refund and contact
terms. A merchant cannot comply with the current admin.

## What to build

### 1. Schema — both dialects

```ts
export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** Markdown. Rendered to HTML at read time, never stored as HTML. */
    body: text("body").notNull().default(""),
    isLive: integer("is_live", { mode: "boolean" }).notNull().default(false),
    /** Show a link in the storefront banner. */
    inNav: integer("in_nav", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("pages_slug_idx").on(t.slug), index("pages_live_idx").on(t.isLive)],
);
```

Mirror it in `db/schema.pg.ts`. Reuse `slugSchema` from `shared/schema.ts` for
validation, and **reserve** the slugs the router already owns — `shop`, `cart`,
`confirm`, `product`, `collection`, `about`, `admin`, `setup`
(`src/router.tsx:25-101`). A page at `/cart` would shadow the cart. Reject those
in the input schema with a message naming the conflict, not a generic error.

### 2. Markdown, safely

Store Markdown; render to HTML. **Do not store HTML and do not
`dangerouslySetInnerHTML` unsanitised output** — the body is admin-authored, but
an XSS here runs on the storefront for every shopper, and [07](07-staff-accounts.md)
makes "admin" a wider set of people.

Render on the **server**, in the repository or route layer, with a Markdown
library plus an HTML sanitiser, and send sanitised HTML to the client. That keeps
the parser out of the shopper's bundle — the storefront is already fighting for
kilobytes (see the chunking note at `vite.config.ts:16-31`). Pin both
dependencies and keep the allowed-tag list tight: headings, paragraphs, lists,
links, emphasis, `code`, `blockquote`, `hr`. No `<script>`, no `<style>`, no
`<iframe>`, no event-handler attributes. Force `rel="nofollow noopener"` and
`target="_blank"` on external links.

### 3. Routes

Public, in `server/routes/public.ts`:

```
GET /api/pages           200: PageSummary[]   // live only: slug, title, inNav, position
GET /api/pages/:slug     200: Page            // live only; 404 otherwise
```

Admin, in `server/routes/admin.ts`, following the collections section
(`server/routes/admin.ts:206-246`) as the closest existing pattern:

```
GET    /api/admin/pages
POST   /api/admin/pages          201: { id }
PUT    /api/admin/pages/:id      204
DELETE /api/admin/pages/:id      204
POST   /api/admin/pages/reorder  204   // reuse reorderInputSchema
```

### 4. Storefront

- A route `/:slug` in `src/router.tsx` — register it **last**, after every
  static route and before `*`, or it will capture `/shop`.
- A `PagePage.tsx` reusing `PageWrapper`.
- Add live `inNav` pages to the banner links in `src/components/layout/`.
  `aboutText` currently drives that link; keep it working.
- Include pages in `getStoreSnapshot` (`db/repository.ts:378`) so the storefront
  gets nav links in its single load, consistent with how collections arrive.
  Send **summaries** in the snapshot, not bodies — a store with ten long pages
  should not inflate every shopper's first payload. Fetch the body per page.

### 5. Migrate `aboutText`

Do not leave two systems. On first run of the new migration, if `aboutText` is
non-empty and no page with slug `about` exists, create one titled "About" with
`isLive: true, inNav: true`. Put this in `db/migrate.ts` as a data step after the
schema migration, or in the seed — not in a SQL migration, since it must run
identically on both dialects.

Keep `aboutText` in the settings schema for one release so an install can roll
back, and mark it deprecated in `db/schema.sqlite.ts` with a comment.

### 6. Admin UI

`src/admin/PagesPage.tsx` — list with drag-reorder (copy
`src/admin/CollectionsPage.tsx`), and an editor reusing `useAutosave`
(`src/admin/useAutosave.ts`) and `SaveIndicator`. A Markdown textarea with a
preview toggle; do not build a rich-text editor.

## Acceptance

- A page created in the admin appears at its slug immediately, no reload
  (mutations invalidate the store key — see `src/admin/queries.ts:56-67`).
- A page slugged `cart` is rejected with a message naming the conflict.
- `<script>alert(1)</script>` in a body renders as inert text.
- A draft page 404s publicly and renders in the admin.
- An existing store's `aboutText` becomes an About page on migrate, once.
- New routes are in `server/security.test.ts`.

## Tests to add

- Sanitiser: script tags, `javascript:` hrefs, `onerror` attributes, nested
  encodings.
- Reserved-slug rejection for each reserved value.
- The `aboutText` migration is idempotent — running it twice makes one page.

## Out of scope

- Page templates, sections, or layout choices.
- A blog with dates, tags, or feeds.
- Per-page SEO overrides — [05](05-seo-metadata.md) covers products; pages can
  fall back to generated tags.
- Scheduled publishing.
