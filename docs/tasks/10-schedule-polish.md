---
task: "10"
title: "Schedule: surface “ahead of a date” and tidy per-date cards"
status: todo
tier: 2
size: S
migration: none
blocked_by: []
blocks: []
touches: src/components/postcard/Schedule.tsx:148 · src/components/postcard/Schedule.tsx:242 · src/components/postcard/Postcard.module.css:253
completed:
shipped_in:
summary: >-
  "Send it ahead of a date" is a real feature hiding as a link at the end of a grey
  footnote, and its popover overlaps the thumbnails on a phone. In "Pick each date"
  mode the delete icons float at different offsets under the date inputs. Give the
  feature a button of its own and align the per-card controls.
---

# 10 · Schedule: surface "ahead of a date" and tidy per-date cards

Found in the 2026-09-10 new-customer walkthrough. Effort: two hours.

## The problem

1. `ArriveBy` (`Schedule.tsx:242`) renders as `Button type="link"` inside
   the delivery-time footnote (`Schedule.tsx:150`), in the footnote's muted
   13 px. It is the answer to "I want this to land on her birthday", which
   is the second most common reason to use the site (brief 00), and nobody
   in the walkthrough noticed it. On a 390 px phone the antd `Popover`
   opens over the thumbnails and the date inputs.
2. In custom mode each `.designItem` stacks thumbnail, date input, then
   `.designMeta` — a flex row with an empty span on the left and the delete
   button pushed right by `space-between` (`Postcard.module.css:253`). With
   the span empty the button's position depends on the input's rendered
   width, so the trash icons sit at different offsets under the two cards.

## What to build

### 1. A control row for the schedule

Move `ArriveBy` out of the footnote and into `.scheduleControls`, after the
date and cadence inputs (or after the "Choose a mail date under each
design." sentence in custom mode), as a default antd `Button` labelled
**Land it by a date** with a `CalendarOutlined` icon. The footnote keeps
its delivery-time sentence and loses the link.

On phones, replace the `Popover` with an antd `Drawer placement="bottom"`
carrying the same content (`.arriveBy`); use the existing 800 px breakpoint
via a `matchMedia` hook (there is `useMediaQuery`-style code in
`src/admin`; if none is shared, add `src/lib/useMediaQuery.ts`). Desktop
keeps the popover.

Copy inside stays as it is — it was reviewed in brief 00's amendment and
deliberately promises no arrival day. Only the trigger changes.

### 2. Per-card layout in custom mode

- Give each card one row for its controls: date input on the left, delete
  and (after brief 09) edit buttons on the right, `align-items: center`.
  Drop the empty span; `.designMeta` in custom mode holds the buttons only.
- `.designItem` width from `8rem` to `min(9.5rem, 100%)` so the date input
  and two icon buttons fit on one line at the smallest phone width.
- In cadence mode the row is the formatted date on the left, buttons on the
  right, as today.

## Acceptance

- "Land it by a date" is visible as a button whenever there is at least one
  design, on desktop and phone; on a 390 px viewport its content opens
  without covering the thumbnails.
- In custom mode with two designs, both delete icons are at the same x
  offset relative to their card; with brief 09's edit button the same
  holds.
- `Schedule.test.tsx` still passes; the axe scan passes on `/create` in
  custom mode.

## Tests to add

- `Schedule.test.tsx`: the button is labelled "Land it by a date" and, when
  pressed, the "The day that matters" input is shown (extend the existing
  `ArriveBy` case rather than duplicating it).
- `e2e/storefront.spec.ts`, `mobile` project: open it and assert the drawer
  (`role="dialog"`) is visible.

## Out of scope

- Changing what the control computes.
