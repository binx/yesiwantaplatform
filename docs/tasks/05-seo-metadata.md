---
task: "05"
title: Per-product SEO metadata
status: done
tier: 1
size: M
migration: two columns
blocked_by: []
blocks: []
touches: server/app.ts:74 · server/routes/public.ts
completed: 2026-09-07
shipped_in: 3bf1fb5
summary: >-
  **The highest-leverage item on this page, and cheaper than it looks.** Every product
  currently shares one meta description — *A Beluga storefront.* — so nothing in the
  catalogue produces a usable Google result or link preview. The instinct is "we need
  SSR", but the server already serves `dist/index.html` on the SPA fallback, which means
  per-route title, description, Open Graph tags and JSON-LD can be templated into that
  HTML on the way out. No framework migration. Add `sitemap.xml` and `robots.txt` while
  you're there.
---

# 05 · Per-product SEO metadata

## The problem

Every page of every Beluga store shares one set of tags, hard-coded in
`index.html`:

```html
<title>Beluga</title>
<meta name="description" content="A Beluga storefront." />
```

The storefront is a client-rendered SPA, so a crawler or a link unfurler fetching
`/product/anything` gets exactly that — no product name, no price, no image. In
practice this means the catalogue does not appear usefully in search results and
every shared link previews identically. **Of everything on the roadmap this is
the one that decides whether a store gets found at all.**

## The approach — no SSR migration

The instinct is "we need server-side rendering". We don't. `server/app.ts:73-81`
already serves `dist/index.html` for every non-API route in production:

```ts
app.use(express.static(dist, { index: false }));
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(dist, "index.html"));
});
```

Replace that `sendFile` with a handler that reads the file once, injects
route-specific tags into the `<head>`, and sends the string. The React app still
boots and renders normally; it just arrives with correct metadata already in the
document. No framework change, no hydration, no build-pipeline work.

## What to build

### 1. Schema — both dialects

Add to the `products` table:

```ts
/** Overrides the generated tag. Null falls back to the product name. */
seoTitle: text("seo_title"),
seoDescription: text("seo_description"),
```

Add both to `productSchema` and `productInputSchema` (`shared/api.ts:31`) as
`z.string().max(70).nullable().default(null)` and `.max(160)` respectively —
those are the lengths Google truncates at, and the admin should say so.

### 2. A metadata resolver

New file `server/seo.ts`:

```ts
export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  image: string | null;
  jsonLd: object | null;
}

export async function metaForPath(pathname: string): Promise<PageMeta>
```

Handle these routes (mirroring `src/router.tsx:91-101`):

| Path | Title | Description |
| --- | --- | --- |
| `/` | store name | `aboutText` truncated, else a generated line |
| `/shop` | `Shop · {store}` | generated |
| `/collection/:slug` | `{collection} · {store}` | generated |
| `/product/:slug` | `seoTitle` ?? `{product} · {store}` | `seoDescription` ?? description truncated to 160 |
| `/about` | `About · {store}` | `aboutText` truncated |
| anything else | store name | store description |

Reuse `findProductBySlug`, `findCollectionBySlug` and `getSettings` from
`db/repository.ts`. **A miss must fall back to store defaults, never throw** —
this runs on the HTML path for every request, including bots probing nonsense
URLs. Wrap the whole resolver in a try/catch that returns the default meta.

For products also emit JSON-LD `Product` with an `Offer`: `name`, `description`,
`image` (absolute), `sku` (the variant id), `price` **as a decimal string**
(`formatMoney` gives a display string — use a plain
`(cents / 100).toFixed(2)` here, since schema.org wants a bare number), 
`priceCurrency`, and `availability` as `https://schema.org/InStock` or
`OutOfStock` derived from the variant inventory. Use the lowest-priced live
variant when a product has several.

### 3. Injection

In `server/app.ts`, read `dist/index.html` once at startup into a module-level
string (it never changes at runtime), then:

- escape every interpolated value for HTML attribute context — product names and
  descriptions are merchant-supplied and go inside `content="..."`. Write a small
  `escapeHtml` helper; do not reach for a template engine.
- serialise JSON-LD with `JSON.stringify(...).replace(/</g, "\\u003c")` to close
  the `</script>` break-out.
- replace the existing `<title>` and `<meta name="description">` rather than
  appending duplicates.
- add `og:title`, `og:description`, `og:image`, `og:type`, `og:url`, and
  `twitter:card` = `summary_large_image`.
- absolute URLs come from `env.PUBLIC_URL` (`server/env.ts`), which is already
  used for the Stripe redirect URLs at `server/routes/checkout.ts:155`.

Keep `express.static` mounted **before** the fallback, so real asset requests
never reach the injector.

### 4. sitemap.xml and robots.txt

Add to `server/routes/public.ts` (no auth, no writes):

- `GET /sitemap.xml` — the home page, `/shop`, `/about` if `aboutText` is set,
  every live collection, every live product. Use `updatedAt` for `<lastmod>`.
  XML-escape slugs.
- `GET /robots.txt` — allow everything, `Disallow: /admin` and `/setup`, and a
  `Sitemap:` line pointing at `PUBLIC_URL`.

Both must be registered so the SPA fallback doesn't swallow them. The fallback
regex `/^(?!\/api\/).*/` matches them, so **mount the public router before it** —
it already is (`server/app.ts:57` vs `:78`), but add a comment saying the order
is load-bearing.

### 5. Admin

Two fields in `src/admin/ProductEditorPage.tsx`, in a collapsed "Search
appearance" section, using the existing `Field` component. Show a live character
count against the 70/160 limits and a preview of the generated fallback when the
field is empty. They autosave like everything else on that form.

## Acceptance

- `curl -s localhost:4000/product/demo-tote | grep -o '<title>.*</title>'` shows
  the product name in a production build.
- A product named `Tote & "Bag" <3` produces valid, escaped HTML.
- `/sitemap.xml` validates and lists only live products.
- Google's Rich Results test accepts the JSON-LD for a product page.
- An unknown path returns the store defaults with a 200 and the SPA still boots.
- Development (`npm run dev`) is unaffected — Vite serves `index.html` and the
  injector only runs in the production branch. Note this limitation in the
  README: metadata is verifiable only against `npm run build && npm start`.

## Tests to add

- Unit-test `metaForPath` for each route shape plus a miss.
- Unit-test `escapeHtml` against `<`, `>`, `"`, `'`, `&`.
- A supertest case against a production-mode app asserting the injected title.
  If wiring `isProduction` in a test is awkward, export the injection function
  and test it directly against a fixture HTML string.

## Out of scope

- Server-side rendering of page content. Only `<head>` is injected.
- Prerendering, or a headless-Chrome render step.
- Per-collection SEO overrides. Products first; collections fall back to
  generated tags.
- Redirect management for changed slugs.
