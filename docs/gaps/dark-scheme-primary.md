---
gap: dark-scheme primary colour
decided: no
touches: src/lib/theme.ts:115 · src/admin/ThemeEditor.tsx:78 · src/admin/adminTheme.ts · src/admin/ProductsPage.tsx:194 · src/admin/ProductEditorPage.module.css:144 · src/components/layout/Footer.module.css:9
summary: >-
  Switch a store to **Dark** with the default primary and every primary button — *Add to
  cart*, *Checkout*, the hero's call to action — is `#18181b` on `#0c0a09`. **How to fix
  this is not decided.** A prior draft sketched deriving a scheme-adjusted primary; it is
  kept below as one option, not a brief anyone should pick up and build.
---

# Known gap · A primary colour that survives the dark scheme

**This is not a task brief.** It was drafted as task 34 and is moved here
because the approach needs more thought before it is decided — theming is
being treated as its own pass rather than fixed piecemeal. It sits in
`docs/gaps/` rather than `docs/tasks/` for the same reason every other gap
does: the problem is real and understood, but not yet a decision to build, so
it is deliberately absent from the roadmap and the task table.

## What was seen

Store set to **Dark**, primary and accent left at their defaults.

- *Add to cart*, *Checkout*, *Browse the shop* and the hero button render
  `#18181b` on the `#0c0a09` page — 1.2:1. Findable by their text, just.
- On a short page (an empty cart) the body colour shows beneath the footer as
  a band, because the footer paints `--beluga-surface` and the shell does not
  fill the viewport. Invisible in the light scheme, where the two colours are
  close.

And in the admin's own (light, untouched) theme, from axe at `wcag2aa`,
serious:

- `.ant-tag-error` filled — *Live · not published* on the products list.
- `._slugPrefix_*` — the `/product/` prefix in the editor, `#a1a1aa` on white,
  2.5:1.
- `.ant-tag-green` filled — *webhooks on* under Stripe in Settings.

## One sketch of a solution

Written while the work was still expected to be a task, and kept because the
shape of the problem is what it records. Treat it as one option that has been
thought through, not as the chosen design.

**Derive the primary per scheme.** The merchant keeps one primary colour, and
Beluga adjusts it per scheme when it has to, saying so in the editor. The
alternative considered was a second *Primary (dark)* field — rejected in this
sketch as a migration and one more thing to set for a case most stores never
hit — but that trade-off, and whether derivation is the right shape at all,
is exactly what is still open.

- Add a function beside `effectivePageColor` in `src/lib/theme.ts:115`:
  test the merchant's colour against `effectivePageColor(theme)` **and**
  `schemePalette[scheme].surface` at `UI_CONTRAST = 3` (WCAG 1.4.11 for
  UI components). If both clear, return it unchanged. Otherwise mix toward
  the scheme's ink (`#fafaf9` in dark, `#18181b` in light) in steps until
  both clear. Do the same for the accent.
- `ThemeEditor.tsx:78` would need a note for when the derived colour differs
  from what the merchant picked, with the derived swatch shown beside the
  picker.
- The admin's own status-tag contrast issues (filled `.ant-tag-error` /
  `.ant-tag-green`, the `.slugPrefix` muted colour) are separate from the
  storefront problem — they're Beluga's own tokens in `adminTheme.ts`, not
  anything the merchant's theme touches.
- The footer seam is a layout bug (`Footer.module.css:9`, shell not filling
  the viewport with `min-height: 100dvh`), independent of the colour
  question.

## What a solution has to handle

- The default dark theme's primary button is legible against both the page
  and surface colours, and its label is legible against the button.
- Whatever mechanism is chosen holds for a full sweep of merchant-chosen
  colours, not just the default — a single example is not a guarantee.
- The admin's filled status tags and muted text clear 4.5:1 on white and on
  the table row colour, independent of whatever the storefront does.
- A short page (e.g. an empty cart) does not show the page colour as a band
  under the footer.
- Email keeps using the raw, undertived accent — a mail client has no scheme.

## Not part of this gap

- The storefront gate and welcome pages, which render before any theme
  exists — [task 33](../tasks/33-storefront-fixes-from-a-blank-store.md)
  covers them.
