---
gap: dark scheme contrast
decided: no
depends_on: docs/tasks/22-typeface-and-locale.md
touches: src/lib/theme.ts · src/lib/theme.test.ts · src/admin/ThemeEditor.tsx · src/admin/ProductsPage.tsx · src/components/layout/Footer.module.css
summary: >-
  With the colour scheme set to **Dark** and the primary colour left at its default, every
  primary button — *Add to cart*, *Checkout*, the hero's call to action — is near-black on
  near-black. Three admin elements fail WCAG AA contrast in the light scheme too, and the
  cart page shows a band of page colour under the footer. **How to fix any of this is not
  decided.** The choice is between deriving a dark-scheme primary automatically, adding a
  second primary field, or constraining the picker, and each changes what a merchant is
  promised.
---

# Known gap · Contrast in the dark scheme, and three tags in the light one

**This is not a task brief.** It records what a blank-store review saw and
why it was left alone: theming is a project of its own, and the palette
questions here need a decision before they need a pull request.

## What was seen

Store set to **Dark**, primary colour untouched (`#18181b`), accent untouched.

- **Primary buttons disappear.** *Add to cart*, *Checkout*, *Browse the shop*
  and the hero button render `#18181b` on a `#0a0a0a` page. They are
  findable, just, by their text. The shopper's most important control has the
  least contrast on the page.
- **The cart page shows a seam.** The footer's surface is a shade lighter than
  the page, and on a short page the body colour shows beneath it as a band.
  Invisible in the light scheme because the two colours are close.

Light scheme, from axe (`wcag2aa`, serious):

- `.ant-tag-error` — the *Live · not published* tag on the products list, red
  on pink, three instances.
- `._slugPrefix_*` — the muted `/product/` prefix in the product editor's Web
  address field.
- `.ant-tag-green` — the *test mode* tag under Stripe in Settings.

`src/lib/theme.test.ts` checks the dark palette's *own* contrast as arithmetic
— surface against text — and passes. It does not check the merchant's primary
against the scheme's surface, because the primary is the merchant's and the
surface is the scheme's, and nothing ties them together.

## What a solution has to handle

- **Whose colour is the primary?** Today it is one value used in both
  schemes. Options: derive a dark-scheme variant (lighten until it clears
  4.5:1 against the surface), which changes a colour the merchant chose
  without telling them; add a second field, *Primary colour (dark)*, which is
  a migration and one more thing to set; or warn in the theme editor when the
  chosen primary fails against the chosen scheme, and let the merchant decide.
  The third is the least presumptuous and the least helpful.
- **antd's own tags** are outside the theme tokens Beluga sets. The red and
  green tags fail at antd's defaults, so fixing them means either a token
  override in `adminTheme.ts` or not using filled tags for status.
- **The arithmetic already exists.** Whatever is chosen, `theme.test.ts` is
  where the guarantee lives, and it should grow a case for primary-on-surface
  under both schemes so the next default cannot regress it.
- **The footer seam** is a one-line CSS fix and only listed here so it is not
  lost; it does not need the decision above.

## Why it is here and not in `docs/tasks/`

A brief has to say what to build. Each option above builds something
different, and the first two change what a merchant's saved theme means.
Choose, then write the brief.
