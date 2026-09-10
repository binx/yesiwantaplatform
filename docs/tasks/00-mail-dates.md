---
task: "00"
title: Mail dates per design
status: done
tier: 0
size: S
migration: none
blocked_by: []
blocks: []
touches: src/pages/CreatePage.tsx:61 · src/components/postcard/Schedule.tsx · shared/postcards.ts
completed: 2026-09-09
shipped_in: 3
summary: >-
  The schedule is one start date and a cadence, so a batch can be "one a week" but not
  "one on her birthday and one at Christmas". The cart already carries a date per design
  (`scheduledDesignSchema`); only the designer refuses to let the buyer set them. Add a
  second mode that does, and an "arrive by" helper that works the mail date back from the
  day the card should land.
---

# 00 · Mail dates per design

## The problem

`Schedule.tsx` says it plainly: "One start date and a cadence … deliberately
that simple rather than a date per card." That is right for the site's
headline use — a batch spread over weeks — and wrong for the second most
common one, which is dates that mean something: a birthday, an anniversary,
the twelve days of Christmas, a countdown to a trip.

Nothing below the designer needs to change. `CartLine.designs[]` is already
`{ designId, mailDate }` per design (`shared/cart.ts:19`), `createPendingOrder`
writes one `mailDate` per postcard, and `assertOrderable`
(`server/routes/checkout.ts:37`) already checks each date individually.
`CreatePage` derives the dates from `startDate + index × cadenceDays`
(`src/pages/CreatePage.tsx:61`) and throws the per-design shape away on the
way in. This brief keeps the shape.

## What to build

### 1. Two schedule modes

State in `CreatePage`:

```ts
type ScheduleMode = "cadence" | "custom";
const [mode, setMode] = useState<ScheduleMode>("cadence");
const [customDates, setCustomDates] = useState<Record<string, string>>({}); // designId → YYYY-MM-DD
```

`scheduled` becomes:

```ts
const scheduled = useMemo(
  () =>
    designs.map((design, index) => ({
      design,
      mailDate:
        mode === "custom"
          ? (customDates[design.id] ?? todayIso())
          : addDaysIso(startDate, index * cadenceDays),
    })),
  [designs, mode, customDates, startDate, cadenceDays],
);
```

When a design is saved in custom mode, seed its date with the latest custom
date already chosen, else today — a buyer adding the fifth card of a
countdown wants to move forward from the fourth, not start again.

The existing "day passed while the tab sat open" effect
(`CreatePage.tsx:72`) must also clamp custom dates: any value below
`todayIso()` is raised to today.

### 2. `Schedule.tsx`

Add a control above the date row. antd `Segmented` with two options, labelled
**Spread them out** and **Pick each date**; only shown when there is more
than one design (with one design the two modes are the same thing and the
existing single date input stays).

In custom mode:

- Hide the start-date and cadence controls.
- Each `designItem` gains an `<input type="date" min={today}>` in place of
  the formatted date, with an `aria-label` of "Mail date for design N". Keep
  the native input: it is what the cadence mode already uses
  (`styles.dateInput`) and it gives phones their own picker.
- Sort nothing. The list stays in the order the designs were saved; the
  dates are what the buyer typed.

Switching from custom back to cadence discards the custom dates (state kept,
but derived dates win). Switching to custom seeds every design from the
cadence dates it had, so the buyer starts from the schedule they could see.

### 3. "Ahead of a date"

*Amended 2026-09-10.* The first version promised an arrival: it subtracted
six business days and said "so it should arrive around". That is not a
promise this shop can make — how long a card takes depends on how far it
travels from the printer and on USPS, anywhere from a couple of days to a
week or more. So the control names no arrival. The buyer picks **the day
that matters** and **how many days before** to mail (default seven, one to
thirty); the mail date is the subtraction, in calendar days via
`addDaysIso(date, -lead)`, and the note says plainly that delivery time
varies. If the result is before today, clamp to today and say it may arrive
after the day. The note under the schedule says the same, in place of the
old "about a week".

### 4. The cart

`CartPage.tsx` already renders each design with its date, so nothing
changes, but check it with two designs dated a month apart: the line should
read as two dates, not one plus a cadence.

## Acceptance

- Two designs can be mailed on two arbitrary future dates and both dates
  reach the order (check `postcards.mail_date` after checkout, or the
  complimentary admin route which shares `assertOrderable`).
- A custom date in the past is refused before the cart, and one that
  *becomes* past while the tab is open is raised to today.
- Cadence mode is unchanged for a buyer who never touches the toggle.
- "Ahead of a date" subtracts the chosen number of calendar days and never
  states an arrival day.
- The axe scan in `e2e/accessibility.spec.ts` passes on `/create` with the
  custom controls showing.

## Tests to add

- `shared/postcards.test.ts`: `addDaysIso` backwards across a month and a
  year boundary.
- A component test for `Schedule` (the pattern is
  `src/pages/LandingPage.test.tsx`): switching to custom shows one date
  input per design; changing one calls back with that design's id.
- `e2e/storefront.spec.ts`: extend "designs a card, adds a recipient and
  sees the right total in the cart" with a second design and a custom date,
  asserting the cart shows both dates.

## Out of scope

- Per-recipient dates. A line is designs × recipients; a birthday card for
  one person is a line with one recipient, which the designer already
  supports. Brief 04A adds birthdays to the address book and can pre-fill
  this mode from them; the hook is `customDates`.
- Recurring yearly sends. That is a subscription and a different product.
- Holidays in the business-day calculation.
