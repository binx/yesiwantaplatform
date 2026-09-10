---
task: "09"
title: Edit a saved design
status: todo
tier: 1
size: S
migration: none
blocked_by: []
blocks: []
touches: src/components/postcard/Schedule.tsx:120 · src/components/postcard/DesignForm.tsx:143 · src/lib/designs.ts:57 · server/routes/designs.ts:119 · src/pages/CreatePage.tsx
completed:
shipped_in:
summary: >-
  Once a design is saved the form clears and the only thing the schedule offers is
  Remove. A typo in the note means removing the card and designing it again, photo
  included. The server already has PUT /api/designs/:id for the back of an unordered
  design; wire it up so the schedule's cards can be edited in place.
---

# 09 · Edit a saved design

Found in the 2026-09-10 new-customer walkthrough. Effort: three to four
hours.

## The problem

`DesignForm.submit` (`DesignForm.tsx:143`) resets every field on success
and the schedule item (`Schedule.tsx:122`) renders a thumbnail, a date and
a delete button. The buyer who notices a typo in "Miss you lots" after
saving has to remove the design and upload the photo again.

The server side exists: `PUT /api/designs/:id` (`server/routes/designs.ts:119`)
takes a `postcardBackSchema` body and updates an unordered design's back,
refusing with 409 once it has been ordered. Nothing on the client calls
it. Changing the *photo* would need a new print file, so that stays a
remove-and-redo; the note, closing line, face, size and ink are what this
brief makes editable.

## What to build

### 1. A hook

In `src/lib/designs.ts`, next to `useSaveDesign`:

```ts
export function useUpdateDesignBack() {
  return useMutation({
    mutationFn: ({ id, back }: { id: string; back: PostcardBack }) =>
      csrfPut<PostcardDesign>(`/designs/${id}`, back).then((d) => postcardDesignSchema.parse(d)),
  });
}
```

`csrfPut` is in `src/lib/api.ts` (`useUpdateProfile` in `src/lib/account.ts` shows the shape). Check whether `PUT /api/designs/:id` is
behind `verifyCsrf`; the POST deliberately is not (it is public and
multipart). If the PUT is not, keep the plain `fetch` shape `saveDesign`
uses rather than adding a session for the sake of it, and say so in the
route comment.

### 2. An Edit button on each scheduled card

In `Schedule.tsx`'s `.designMeta`, beside the delete button, an antd
`Button type="text" size="small" icon={<EditOutlined />}` with
`aria-label={`Edit design ${index + 1}`}`, calling a new prop
`onEdit(index)`.

### 3. The form in edit mode

`DesignForm` gains an optional prop `editing?: PostcardDesign | null` and
`onEdited(design)` / `onCancelEdit()`. When `editing` is set:

- The front shows the saved thumbnail (`editing.thumbnail`, via
  `ProductImage`) in the frame, not draggable, with a caption **"To change
  the photo, remove this design and save a new one."** The upload button,
  orientation switch and zoom are hidden.
- The back controls are seeded from `editing.back`.
- The primary button reads **Save changes** and calls the update hook; a
  **Cancel** button beside it restores the blank form.
- On success, `onEdited` replaces the design in `CreatePage`'s `designs`
  array (same id, new `back`), the form clears, and the status note reads
  "Updated."

`CreatePage` holds `const [editingIndex, setEditingIndex] = useState<number
| null>(null)` and scrolls the design panel into view when it is set
(`document.getElementById("design-heading")?.scrollIntoView()`).

### 4. The fit gate applies here too

If brief 07 has landed, the same overflow warning disables **Save
changes**. If it has not, land 07 first; editing is where a buyer is most
likely to lengthen a note.

## Acceptance

- Save a design, click Edit, change the note, Save changes: the schedule
  keeps the same card in the same position with the same date; the cart
  (which re-fetches designs by id) shows the new note in the order
  confirmation after checkout.
- Cancel restores a blank form and leaves the design untouched.
- A design handed in by the gallery's "send again" (`?designs=` on
  `/create`, brief 05) may already belong to an order, and the PUT answers
  409 for it. That case renders the server's message in the form's error
  alert with the hint "Remove it from the schedule and save a fresh copy
  to change the note." — not a blank form, and not a silent no-op.

## Tests to add

- `src/lib/designs.test.ts` or the `DesignForm` component test: the update
  hook posts the back to `/api/designs/:id` and the form calls `onEdited`
  with the parsed design.
- `server/designs.test.ts` (or wherever `PUT /designs/:id` is covered):
  already tests the 409; add a case that the response carries the updated
  `back`.
- `e2e/storefront.spec.ts`: save, edit the note, save changes, add a
  recipient, add to cart; expect the cart's design query to return the
  edited note (assert on the order confirmation if Stripe is stubbed, else
  on the API response through `page.waitForResponse`).

## Out of scope

- Replacing the photo or re-cropping. That is a new print file and a new
  design id; remove-and-redo is honest about it.
- Editing from the cart page.
