---
task: "26"
title: "Building on Beluga: which files are yours to change"
status: done
tier: 0
size: S
migration: none
blocked_by: []
blocks: []
touches: docs/building-on-beluga.md · README.md
completed: 2026-09-09
shipped_in: 22
summary: >-
  The README invites a developer to fork and replace components, and the task briefs hold
  the invariants, but nothing connects the two: no page says which files are cosmetic and
  which hold a rule that breaks silently when edited. Write the map — what is safe to
  replace, what to extend through a seam, what not to touch — as one document that the
  site plan's "Building on Beluga" section can later absorb.
---

# 26 · Building on Beluga: which files are yours to change

The site plan (§1) says the reader is a developer building a custom store, and
that the docs should be organised by *what may I change*. The README's hero
copy tells them to *replace this component entirely*. Between those two
sentences there is nothing that says which components that applies to.

## The problem

A developer arriving to customise Beluga sees one `src/` tree. In it:

- `LandingPage.tsx`, `Banner.tsx`, `Footer.tsx`, the CSS Modules and
  `index.css` are cosmetic. Rewrite them freely.
- `CartPage.tsx`, `ConfirmPage.tsx` and `ProductDetails.tsx` look the same
  but each carries a rule from `docs/tasks/README.md`: the cart stores
  identifiers only; the confirmation page proves nothing about payment; the
  quantity control clamps to stock. Rewriting them as a designer would is how
  a store ends up showing stale prices or a "thank you" for an order that
  never paid.
- `src/lib/store-source.ts` is the documented seam for changing where the
  catalogue comes from. Nothing else in `src/lib` is, and nothing says so.
- `server/routes/checkout.ts` and `server/routes/webhook.ts` are the payment
  invariants. Every other route is ordinary.
- `emails/*.hbs` are meant to be edited; `shared/schema.ts` is meant to be
  extended in one direction only, with both dialects and a migration.

None of that is discoverable without reading the task briefs, which are
written for people implementing features, not people restyling a shop.

## What to write

One page, `docs/building-on-beluga.md`, in the README's register — why it
works this way, and what breaks if you assume otherwise — with four sections:

### 1 · Yours to replace

The files a fork is expected to rewrite, with one line each on what they read
from the store so a replacement stays data-driven: the landing page, the
banner and footer, the product card and list, the collection tile, the
`index.css` baseline, the email templates. State plainly that a replacement
component should read from `useStore()` and the `--beluga-*` tokens, and why
(task 21's admin-edited copy, the theme editor's preview).

### 2 · Extend through the seam

`src/lib/store-source.ts` for the catalogue; `shared/catalog.ts` for search
and sort; `ImageStore` once task 25 lands; `templateForStatus` in
`server/email.ts` for which email goes out when. For each, the shape of the
function and one worked example — swapping the fixture for the API is the
example the README already tells.

### 3 · Not without reading the invariants

`CartPage`, `ConfirmPage`, `ProductDetails`' quantity handling,
`server/routes/checkout.ts`, `server/routes/webhook.ts`, anything under
`db/`. For each, the invariant number from `docs/tasks/README.md` it holds and
the one-sentence failure if it is broken. Link, do not repeat: the invariants
list is the source and this page is the map to it.

### 4 · Adding a field

The shortest correct walk-through of the pattern every brief follows: both
dialect files, `npm run db:generate`, the zod schema in `shared/`, the input
schema in `shared/api.ts`, the repository function, the route, the
`security.test.ts` entry, the editor. One paragraph per step, no screenshots.
This exists so an assistant asked "add a subtitle to products" produces the
right eight edits rather than the obvious three.

Then, in the README, one sentence under **Architecture** pointing at the page,
and in `LandingPage.tsx` the hero copy names it (or task 21 has already
replaced the copy).

## Out of scope

- The docs site. The site plan owns where this page eventually lives; this
  brief writes it as Markdown in `docs/` so it exists now and can move later.
- Screenshots. Per the site plan, none.
- A plugin or hook system. This page documents the seams that exist; adding
  seams is code, and each would want its own argument.

## Definition of done

Per `docs/tasks/README.md`, minus the code checks:

- `docs/building-on-beluga.md` exists with the four sections, every file it
  names exists at the path given, and every invariant it cites matches the
  numbering in `docs/tasks/README.md`.
- The README links to it.
- Someone who did not write it can follow §4 to add a nullable text column
  to products end to end. Say in the PR who tried.
