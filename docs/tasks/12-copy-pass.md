---
task: "12"
title: "Copy: one delivery estimate, tenses, and labels"
status: todo
tier: 1
size: S
migration: none
blocked_by: []
blocks: []
touches: src/pages/LandingPage.tsx:89 · src/components/postcard/Schedule.tsx:150 · src/pages/CartPage.tsx:147 · src/components/postcard/DesignForm.tsx:274 · src/components/postcard/DesignForm.tsx:281 · src/pages/account/AccountRegisterPage.tsx:38
completed:
shipped_in:
summary: >-
  Small strings that contradict each other or mislead: two different delivery
  estimates on the home page and the designer; "Mailed" in the cart for cards that
  have not gone; a font field called "Handwriting" whose first option is also
  "Handwriting"; "Love, Rachel" pre-filled in the closing line; and "If that address
  can hold an account". One PR, no logic.
---

# 12 · Copy: one delivery estimate, tenses, and labels

Found in the 2026-09-10 new-customer walkthrough. Effort: one to two
hours, most of it updating the tests that assert on these strings.

## The changes

| Where | Now | Change to | Why |
|---|---|---|---|
| `LandingPage.tsx:89` | "Postcards are typically delivered about one week after the scheduled mailing date." | "Most cards arrive within a week of their mail date — a couple of days when the address is near the printer, longer when it isn't." | Must agree with the designer. Brief 00's amendment settled the wording: no promised day. |
| `Schedule.tsx:150` | "Delivery time varies: a couple of days when the address is near the printer, a week or more when it isn't." | "Most cards arrive within a week of their mail date — a couple of days when the address is near the printer, longer when it isn't." | Same sentence in both places. Put it in `shared/copy.ts` as `DELIVERY_ESTIMATE` and import it in both, so they cannot drift again. Check `emails/` for a third version and use the constant there too. |
| `CartPage.tsx:147` | "Mailed Sep 10, 2026" / "Mailed Sep 10, 2026 to Sep 17, 2026" | "Mails Sep 10, 2026" / "Mails Sep 10 to Sep 17, 2026" | Future tense for cards not yet sent. `customerStatusLabel` in `src/lib/postcards.ts:23` keeps "Mailed" for the `sent` status, which is past. |
| `Schedule.tsx:224` (inside ArriveBy) | "Mailed Sep 3, 2026. How long it takes from there…" | "Mails Sep 3, 2026. How long…" | Same. |
| `DesignForm.tsx:281` | field label "Handwriting" | "Style" | The first option is also "Handwriting". |
| `DesignForm.tsx:274` | closing-line placeholder "Love, Rachel" | "e.g. Love, Grandma" | Buyers read it as pre-filled with someone else's name; the "e.g." makes it read as a prompt. Placeholder only; `defaultPostcardBack.valediction` stays empty. |
| `AccountRegisterPage.tsx:38` | "If that address can hold an account, we've sent a link to verify it. Verifying is also what lets us attach any past orders placed with that email to your new account." | "We've sent a link to verify your email. Once you've clicked it, any orders you've placed with this address will show up in your account." | The enumeration-safe wording is kept (the sentence is true whether or not the address was new); it just stops sounding like a database. Brief 13 changes this page further; land 13 after this or fold this row into it. |
| `src/pages/CartPage.tsx` empty state | "Hmmmm, there's nothing in your cart yet." | keep | Fine as is; listed so nobody "fixes" it. |

## Also

- The `dd` for "Where can I send them to?" (`LandingPage.tsx:91`) says the
  US only. That is true while `internationalPostcardPriceCents` is null;
  when it is set, brief 02C's storefront already accepts other countries
  but this answer still apologises. Make the answer conditional on the
  store setting: with a price, "Anywhere in the United States, and to
  {n} other countries — international cards cost {price} and take about
  two weeks longer."

## Acceptance

- `grep -rn "typically delivered\|Delivery time varies" src shared emails`
  returns nothing; both pages render `DELIVERY_ESTIMATE`.
- The cart says "Mails …" for a fresh line; the order page still says
  "Mailed" for a sent card.
- `npm test` and `npm run test:e2e` pass with the assertions updated
  (`e2e/storefront.spec.ts:78` matches `/Mailed .+ to .+/` today).

## Out of scope

- The photo hint paragraph and the "I'm sold already" button; both were
  reviewed and kept.
