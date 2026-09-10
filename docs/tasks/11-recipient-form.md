---
task: "11"
title: "Recipients: a state picker, honest buttons, and an unbroken row"
status: todo
tier: 1
size: S
migration: none
blocked_by: []
blocks: []
touches: src/components/postcard/RecipientFields.tsx:98 · src/components/postcard/RecipientFields.tsx:156 · src/lib/recipients.ts:41 · src/lib/recipient-form.ts:68 · src/components/postcard/Recipients.tsx:273 · src/components/postcard/Postcard.module.css:277
completed:
shipped_in:
summary: >-
  Three things on the address form: the State box takes any two letters and sends
  "ZZ" off to USPS; the button under a rejected address says "Check the address" and
  merely closes the notice; and a ZIP error stretches the City and State inputs
  taller than the ZIP one. Plus the verification copy is British-spelled and mentions
  "the printer", which a buyer has never heard of.
---

# 11 · Recipients: a state picker, honest buttons, and an unbroken row

Found in the 2026-09-10 new-customer walkthrough. Three parts, one PR is
fine. Effort: three hours.

## A. A state picker

`RecipientFields.tsx:107` is a free-text `Input maxLength={2}` with a "CA"
placeholder. `recipientSchema` (`shared/postcards.ts:155`) checks only
`/^[A-Za-z]{2}$/`, so "ZZ" passes and goes to Lob's verifier, which then
says USPS does not recognise the address — true, but the wrong field is
blamed.

- Add `shared/us-states.ts`: the fifty states plus DC and the USPS
  abbreviations for the territories and military codes Lob accepts
  (`AA AE AP AS GU MP PR VI`), as `[{ code, name }]`, and `US_STATE_CODES`
  as a `Set`.
- `recipientSchema`: for `country === "US"`, the state must be in that set;
  message **"Choose a state."**
- `RecipientFields`: for US, an antd `Select showSearch` over the list
  (label "CA · California", value "CA"), `optionFilterProp="label"`, so
  typing either "ca" or "calif" finds it. Keep the free-text input for
  `abroad`. The CSV importer (`src/lib/recipients-csv.ts`) already
  normalises to two letters; a full state name in a CSV should map through
  the same list — add that to `parseRecipientsCsv` so "California" imports
  as "CA".
- `autoComplete` on the wrapper: antd's Select does not take it; that is
  fine, browsers autofill the street and ZIP.

## B. Honest buttons and plain words

`describeVerification` (`src/lib/recipients.ts:41`) and the notice
(`RecipientFields.tsx:156`):

| Now | Change to |
|---|---|
| "USPS doesn't recognise this address." | "USPS doesn't recognize this address." |
| "Check the street number and the ZIP. The printer would refuse it after payment, so it can't go in as it is." | "Check the street number and the ZIP. It can't be mailed as written." |
| "USPS doesn't recognise that apartment or suite number at this building." | "USPS doesn't recognize that apartment or suite number at this building." |
| button "Check the address" (tone `block`) | "Edit the address" |
| `Recipients.tsx:273` "USPS doesn't recognise them. Fix or remove them before adding this batch to the cart." | "USPS doesn't recognize them. Fix or remove them before adding this batch to the cart." |

The `block` button's handler is `onDismiss` (`recipient-form.ts:68`),
which only clears the notice. Make it do what its new label says: dismiss,
then focus the street-address input. `RecipientFields` has `nameRef`; add a
`line1Ref` the same way and have `VerificationNotice` receive an
`onEdit` that the parent wires to `check.dismiss(); line1Ref.current?.focus()`.
The draft is still in the form at that point (commit never ran), so the
buyer edits in place.

Spelling elsewhere: grep `recognis` across `src/`, `shared/`, `emails/`
and `server/` and change every user-facing instance. Tests that assert on
the strings (`Recipients.test.tsx:73`) change with them.

## C. The City · State · ZIP row

`.recipientRow` (`Postcard.module.css:277`) is a three-column grid; each
cell is a `Field` (`display: grid`). When the ZIP field shows an error the
row grows, and the City and State cells stretch to the row's height, so
their inputs render taller than the ZIP input.

- `.recipientRow { align-items: start; }`
- `.field { align-content: start; }` (`Postcard.module.css:115`), which
  also fixes the same effect anywhere else two `Field`s share a row.
- Below 400 px, make the row two rows: City full width, then State and
  ZIP — this is the item from `docs/NEXT-STEPS.md` §6 and belongs here.

## Acceptance

- A US recipient cannot be added with a state outside the list; the error
  sits under the state field, not in the USPS notice.
- After "Edit the address", focus is in the street-address input with the
  typed values still there.
- With a ZIP error showing, all three inputs in the row are the same
  height.
- No user-facing "recognise" remains.

## Tests to add

- `shared/postcards.test.ts`: `{ country: "US", state: "ZZ" }` fails with
  "Choose a state."; `"PR"` passes.
- `Recipients.test.tsx`: for an `undeliverable` verification, the button is
  "Edit the address" and after clicking it the street input has focus
  (`toHaveFocus()`) and its value is unchanged.
- `src/lib/recipients-csv.test.ts`: a row with "California" imports as
  "CA".

## Out of scope

- Autocomplete of the whole address. Lob has an autocompletion endpoint;
  it is a separate brief if wanted.
