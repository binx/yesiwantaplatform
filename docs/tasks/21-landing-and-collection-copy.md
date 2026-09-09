---
task: "21"
title: Landing page and collection copy the admin can edit
status: todo
tier: 1
size: M
migration: columns on store_settings and collections
blocked_by: []
blocks: []
touches: shared/schema.ts · shared/api.ts · db/schema.sqlite.ts · db/schema.pg.ts · src/admin/SettingsPage.tsx · src/admin/CollectionsPage.tsx · src/pages/LandingPage.tsx
completed:
shipped_in:
summary: >-
  The landing page's hero says "Edit it in the admin" and cannot be; the only things a
  merchant controls on the front page are the store name and which collection is featured.
  Collections have a name and a cover and nothing to say. Give the hero a heading, a line
  of text, a button label and target, and an optional image; give a collection a
  description. Both are plain text and Markdown respectively, rendered through the
  existing sanitiser, so this adds no new HTML surface.
---

# 21 · Landing page and collection copy the admin can edit

The first thing a new developer looks for after setup is where the front page's
words come from. The page says the admin; the admin has nothing. The second
thing is a collection page, which has a title, a grid and no way to introduce
either.

## The problem

`src/pages/LandingPage.tsx` renders `store.name` as the heading, a hardcoded
paragraph, a hardcoded **Shop everything** button, the featured collection, and
the collection tiles. Every store built on Beluga opens with the same sentence
until someone edits JSX. That is fine for the developer who forks — the README
says so — and wrong for the merchant on the same team who was told the admin
edits it.

`collectionSchema` (`shared/schema.ts:161`) is `id`, `slug`, `name`, `cover`,
`productIds`. A collection page cannot say what the collection is, and the
collection tile on the landing page is a name over a picture. Pages (task 08)
hold prose that is not about the catalogue; a collection's own introduction is
about the catalogue and belongs on the collection.

## What to build

### 1 · Hero

Four nullable columns on `store_settings`, in both dialect files, and the same
four on `themeSchema`'s sibling — a new `heroSchema` on `storeSchema` rather than
more theme fields, since this is copy, not look:

| Column | Type | Renders as |
| --- | --- | --- |
| `hero_heading` | text | `<h1>`; null means `store.name` |
| `hero_text` | text | the paragraph; null hides it |
| `hero_button_label` | text | the button; null means *Shop everything* |
| `hero_button_href` | text | the button's target; null means `/shop` |
| `hero_image_path` + width, height, alt | image, like the logo | full-bleed behind the hero; null keeps the flat background |

Plain text, all of it. The heading and paragraph are not Markdown: a hero is
one sentence, and a bold word inside it is a design decision the theme should
make. `hero_button_href` is validated as a same-origin path (`/…`) or an
`https://` URL, the same rule the page editor uses for links — a hero button
should not be able to point at `javascript:`.

**Settings** gains a **Landing page** card between *Identity* and *Look*, with
those fields and the `ImageManager`-style single-image control the logo already
uses. The theme preview at the bottom of Settings should show the hero copy,
since that is where the merchant will look to see the effect.

`LandingPage.tsx` reads them with the fallbacks above, so a store that sets
nothing renders exactly as today — minus the sentence that was never true.
Task 20's group 5 replaces that sentence in the meantime; this brief supersedes
it.

### 2 · Collection description

One nullable `description` column on `collections`, Markdown, max 5,000
characters, in the same input schema task 17 added `cover` to
(`collectionInputSchema`, `shared/api.ts:91`). Render it through the server's
existing Markdown pipeline (`server/markdown.ts`), so the storefront still ships
no parser and the same allow-list applies. Because the storefront receives
collections in the `/api/store` snapshot, add `descriptionHtml` to the public
`collectionSchema` and leave the Markdown source on the admin shape only —
exactly the split `pageSchema` / `pageDraftSchema` already make.

The collection page renders it under the heading, above the search and sort
controls; the landing page tile does not, since a tile is a name and a picture.
The Collections admin gets a textarea per card next to the cover control, with
the same *Write / Preview* toggle the page editor has — reuse it rather than a
second one.

### 3 · Search appearance

`server/seo.ts` builds a collection's description as `${name} from ${store}`.
Use the first 160 characters of the rendered description's text when there is
one. This is the reason the description belongs on the collection rather than
in a Page: the link preview for `/collection/home-goods` gets better for free.

## Migration

Both dialects, `npm run db:generate`, and the CSV export (task 15) is unaffected:
collections are not in the catalogue file. No backfill; every new column is
nullable with a fallback in the reader.

## Out of scope

- A page builder, sections, or reordering the landing page. The hero is one
  block with four strings; anything more is a different product.
- Markdown in the hero. See above.
- Collection descriptions in the CSV. Collections are not in the file.

## Definition of done

Per `docs/tasks/README.md`, plus:

- Schema change in both dialect files and both migration folders.
- A component test: a store with no hero fields renders the store name, the
  default button, and no paragraph; a store with all four renders them.
- A server test that a collection description round-trips through the admin
  and comes back sanitised in `/api/store`.
- A test that `hero_button_href` refuses `javascript:` and accepts `/shop` and
  `https://…`.
- README **The admin** section says the landing page copy is edited under
  Settings.
