---
task: "07"
title: "Back of card: the message must fit"
status: todo
tier: 0
size: M
migration: none
blocked_by: []
blocks: []
touches: src/components/postcard/PostcardBackMock.tsx · src/components/postcard/Postcard.module.css:172 · print/back.hbs:27 · src/components/postcard/DesignForm.tsx:258 · shared/postcards.ts:103
completed:
shipped_in:
summary: >-
  A note longer than the message column is silently clipped at BOTH ends, on screen
  and in print, because the column is vertically centred with overflow hidden. The
  buyer sees the middle of their note and the counter says 318 / 600 as if all is
  well. Anchor the text to the top in both faces, tell the buyer when it will not fit,
  and do not let a design that will lose words be saved.
---

# 07 · Back of card: the message must fit

Found in the 2026-09-10 new-customer walkthrough. Effort: about half a day.

## The problem

`PostcardBackMock` and `print/back.hbs` both lay the message column out as a
flex column with `justify-content: center` and `overflow: hidden`
(`Postcard.module.css:176`, `back.hbs:27` and `:34`). A note that is taller
than the 3.75 in column is centred, so the overflow is split between the top
and the bottom and the *opening* of the note disappears. At the default size
of 20 pt, about ninety characters fit; the schema and the textarea allow 600
(`shared/postcards.ts:103`, `DesignForm.tsx:262`). A buyer who writes a real
paragraph sees "seen. The truck made it, barely…" in the preview, pays, and
mails a card whose first line is missing. Nothing warns them.

Reproduce: `/create`, any photo, paste 300 characters into "Note for the
back", leave the size at 20. The preview's first line is cut off. Switch to
Script (Sacramento) and it is worse.

## What to build

### 1. Anchor to the top, in both faces

Change `justify-content: center` to `flex-start` in `.backText`
(`Postcard.module.css:176`) and `.safe` (`back.hbs:27`). Now an overflow
clips the *end* of the note, which is at least the part the writer can see
being lost. The QR footprint (`.backReply`, `.reply`) already uses
`margin-top: auto` and keeps its place at the bottom.

The README's convention applies: the two faces change together or not at
all. Check the mock against the print HTML after the change with a long note
at 12, 20 and 32 pt — the same lines should be visible in both.

### 2. Measure whether it fits

The mock is the measurement. Give `PostcardBackMock` an optional callback:

```ts
interface PostcardBackMockProps {
  back: PostcardBack;
  replyLink?: boolean;
  /** Called whenever the message column's content fits or stops fitting. */
  onFit?: (fits: boolean) => void;
}
```

Inside, a `ref` on the `.backText` div and a `ResizeObserver` on it: `fits =
el.scrollHeight <= el.clientHeight + 1`. Report on mount, on every `back`
change and on resize (the phone layout scales the card, see brief 14 in
`docs/NEXT-STEPS.md` §6). Fonts loading late change the answer — subscribe
to `document.fonts.ready` and re-measure once it resolves; brief 14A makes
sure those fonts are actually requested.

This measures the on-screen mock, not Lob's renderer. They share inch
geometry, font faces and line height, so the answer is the same to within a
line; the top anchoring in §1 is what makes a near miss harmless.

### 3. Tell the buyer, and hold the Save

In `DesignForm`:

- `const [fits, setFits] = useState(true)` fed by `onFit`.
- When `!fits`, an antd `Alert type="warning"` between the back controls and
  the actions, title **"That's more than fits on the card"**, description
  **"Shorten the note, or choose a smaller size. What you see on the card is
  what prints."**
- `Save this design` is `disabled` while `!fits`, and the status note beside
  it reads the same message, so a keyboard user hears why.

Do not shrink the font automatically. The buyer chose the size; the card is
small and 12 pt is already the floor.

### 4. The counter

Keep `maxLength={600}` — a 12 pt note in Quicksand can hold roughly that —
but drop `showCount`. The number was reassuring people that 318 / 600 was
fine. The fit warning is the honest signal.

## Acceptance

- A note that overflows shows the warning and disables Save; deleting text
  until it fits clears both, with no reload.
- With the same long note, the mock and a rendering of `back.hbs` (open the
  HTML the sweep would send — `renderBack` in `server/lob.ts`, or the
  "Send a test postcard" admin button against Lob's sandbox) show the same
  first line at the top.
- A note that fits behaves exactly as today.
- The axe scan in `e2e/accessibility.spec.ts` passes on `/create`.

## Tests to add

- A component test for `DesignForm` (there is none yet; the pattern is
  `src/components/postcard/Schedule.test.tsx` with `renderWithProviders`).
  jsdom has no layout, so stub `scrollHeight`/`clientHeight` on the column
  with `Object.defineProperty` and drive `ResizeObserver` from the existing
  mock in `vitest.setup.ts` (add one if missing). Assert: overflow → warning
  shown and Save disabled; fits → neither.
- A Playwright case in `e2e/storefront.spec.ts`: paste 400 characters,
  expect the warning and a disabled Save; clear it, expect Save enabled.

## Out of scope

- A server-side fit check. The API is public and a script can still post an
  overflowing note; it prints clipped from the top of the column, which is
  the same outcome as before this brief for a note that fits. Revisit if the
  admin overview ever needs a "will not fit" flag.
- Auto-shrinking the font.
