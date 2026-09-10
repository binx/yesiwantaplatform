---
task: "08"
title: "Designer: photo frame, layout, price line, and the batch explainer"
status: todo
tier: 1
size: M
migration: none
blocked_by: []
blocks: []
touches: src/components/postcard/DesignForm.tsx:157 · src/components/postcard/Postcard.module.css:8 · src/components/postcard/Postcard.module.css:341 · src/pages/CreatePage.tsx · src/pages/CreatePage.module.css
completed:
shipped_in:
summary: >-
  Four things a first-time buyer trips on in the designer, all layout or affordance,
  none needing new data: the big empty photo frame is not clickable; the front row
  leaves a blank column on desktop and a screen-tall box on phones; the price line
  wraps into stranded operators on phones; and nothing says every design goes to every
  recipient until the multiplication at the bottom.
---

# 08 · Designer: photo frame, layout, price line, and the batch explainer

Found in the 2026-09-10 new-customer walkthrough. Four parts, each its own
PR. Effort: A one hour · B two to three hours · C one hour · D one hour.

## A. The empty frame opens the file picker

`.frontPreview` (`DesignForm.tsx:157`) is a `role="img"` box with pointer
handlers for dragging. Empty, it says "Your photo goes here" and does
nothing when clicked; the only way in is the small **Upload a photo**
button beside it. Every tester clicked the frame first.

- When `picked === null`, make the frame a button: render the empty state
  as a `<button type="button">` that fills the frame (`.frontEmpty`), with
  the upload icon, the text **"Add a photo"** and a second line in
  `.note` style, **"JPG, PNG or HEIC, straight from your phone is fine."**
  Its `onClick` is the same `document.getElementById(fileId)?.click()` the
  upload button uses. Keep the visible upload button too.
- Accept a drop: `onDragOver` (prevent default) and `onDrop` on the frame
  calling `choose(event.dataTransfer.files?.[0])`. A dashed outline while
  dragging over (`.frontPreview[data-dragging]`).
- Once a photo is picked, the frame goes back to being the drag surface it
  is today; the button unmounts.
- Cursor: `pointer` when empty, `grab` when a photo is in it
  (`Postcard.module.css:40`).

## B. The front row, desktop and phone

On a 1280 px viewport the controls column beside the portrait frame is
three short controls and a paragraph, so the row's right half is blank for
most of the frame's height. On a 390 px phone the frame is the full width
and taller than the screen before any control is visible.

Desktop:

- Change `.frontRow` (`Postcard.module.css:22`) so the frame column is
  `min(16rem, 100%)` for portrait and let the controls column take the
  rest, with `.frontControls { max-width: 32rem }` so the hint paragraph
  does not run the full width.
- Move the low-resolution `Alert` and the hint paragraph under the frame
  rather than beside it, so the column of controls is just the controls.

Phone (`@media (max-width: 800px)`, the existing breakpoint at
`Postcard.module.css:414`):

- Cap the frame at `max-height: 55vh` with `width: auto` and `margin: 0
  auto`, so the orientation switch and the upload button are on screen
  with it. The safe-area frame is a percentage border and scales with it.
- Put the orientation switch and the upload button in one row above the
  frame; zoom and the hint below.

The crop geometry is computed from the frame's measured size
(`previewGeometry`, `useEffect` with `ResizeObserver` at
`DesignForm.tsx:70`), so resizing the frame changes nothing in what prints.
Confirm by saving a design on a phone-width viewport and checking the
print file's crop against the desktop one for the same photo and offset.

## C. The price line on phones

`.total` (`Postcard.module.css:341`) is a flex row with `flex-wrap`, so on a
phone it breaks into "2 designs ×" / "0 recipients × $1.40 each" / "= $0.00"
with the operators stranded at line ends.

- Wrap each factor with its following operator in a `<span
  className={styles.term}>` (`white-space: nowrap`): "2 designs ×",
  "1 recipient ×", "$1.40 each =" and then the total.
- Below 480 px, drop the flex row for a two-line layout:

  ```
  2 designs × 1 recipient × $1.40 each
  = $2.80
  ```

  i.e. `.total { flex-direction: column; gap: 0.25rem }` with the `=` and
  the total in their own `.term`.
- The count boxes (`.count`) stay.

## D. Say what a batch is

The three panels read as independent steps. The only place the buyer
learns that every design goes to every recipient is the multiplication at
the bottom, after they have already added a second design that they meant
for someone else.

- Under the `<h1>` in `CreatePage.tsx`, one line in `.note` style:
  **"Every design you save here goes to every recipient you add, on the
  dates you choose. Want different cards for different people? Add this
  batch to the cart and make another."**
- Under "3. Postcard recipients", when `designs.length > 1`: **"All
  {designs.length} designs go to each person below."**
- The status note beside "Add to cart" already says "You can add another
  batch from the cart" — keep it.

## Acceptance

- Clicking or tapping the empty frame opens the OS file picker; dropping a
  file onto it picks that file. Keyboard: the empty frame is focusable and
  Enter opens the picker.
- On a 1280 px viewport nothing in the front row is more than one control's
  height below its neighbour; on 390 px the orientation switch is visible
  without scrolling past the frame.
- The price line never ends a row with `×` or `=` at any width from 320 px
  up.
- The two explainer sentences are present and the axe scan passes.

## Tests to add

- `DesignForm` component test (create it in this brief if 07 has not):
  clicking the empty frame calls `click()` on the file input (spy on
  `HTMLInputElement.prototype.click`).
- `e2e/storefront.spec.ts`, `mobile` project: after `goto("/create")`,
  assert the "Orientation" radio group is within the viewport
  (`toBeInViewport()`) before any scrolling.

## Out of scope

- The sticky total bar on phones from `docs/NEXT-STEPS.md` §6. Worth doing,
  but it is a different change to the same file; do it after C.
- Multiple photos per card (brief 01B).
