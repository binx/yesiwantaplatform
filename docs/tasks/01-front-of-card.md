---
task: "01"
title: "Front of card: crop offset and collage"
status: in-progress
tier: 1
size: L
migration: none
blocked_by: []
blocks: []
touches: server/lob.ts:91 · server/uploads.ts:180 · src/components/postcard/DesignForm.tsx · shared/postcards.ts · shared/api.ts:141
completed:
shipped_in: 4
summary: >-
  The front is one photo, centre-cropped, and the crop cannot be moved — the single most
  common complaint with any auto-crop is the head at the top of the frame. Part A lets the
  buyer drag and zoom the photo inside the card, with the preview and the print file doing
  the same arithmetic. Part B builds on the same per-slot crop to offer two-, three- and
  four-photo layouts.
---

# 01 · Front of card: crop offset and collage

## Progress

- **A** built. `cropSchema` / `cropRect` in `shared/postcards.ts`; the server
  crops with `cropToCard` (resize + extract) and cuts the thumbnail from the
  same face; the designer draws the photo at the crop's geometry and takes
  drag, arrow keys and a zoom slider. Also fixed on the way: the preview box
  collapsed to 2px on desktop viewports because its percentage width sat in
  an `auto` grid track.
- **B** not started; moved to the backlog in `README.md` on 2026-09-10. The spec below stands.

Two parts. **A ships alone** and is small. **B depends on A** and is the
larger piece; nothing else in the roadmap depends on B.

## The problem

`printFile` in `server/lob.ts:91` crops with `fit: "cover", position:
"centre"`, and the preview in `DesignForm.tsx` shows the same crop with
`object-fit: cover`. The comment there is right that the two agree; the
trouble is that neither can be moved. A tall photo of two people standing up
loses their heads; a wide beach shot loses whichever end the buyer wanted.

There is no editing after save and no original kept — `storePostcardDesign`
(`server/uploads.ts:180`) writes only the print file and the thumbnail — so
the crop has to be chosen before the upload and sent with it.

## Part A · Reposition and zoom

### 1. The crop, in `shared/postcards.ts`

```ts
/**
 * Where the photo sits inside the card, as fractions of the overflow.
 *
 * `x` and `y` are 0..1: 0.5 is the centre crop the site always did, 0 pins
 * the photo's left/top edge to the card's, 1 its right/bottom. `zoom` scales
 * the photo up from the smallest size that covers the card. The same three
 * numbers drive the preview and the print file, which is what keeps them
 * the same picture.
 */
export const cropSchema = z.object({
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.5),
  zoom: z.number().min(1).max(3).default(1),
});
export type Crop = z.infer<typeof cropSchema>;
export const defaultCrop: Crop = { x: 0.5, y: 0.5, zoom: 1 };

/**
 * The rectangle of a `source`-sized image that fills a `target` at this crop.
 * Pure, so the browser and sharp call the same function.
 */
export function cropRect(
  source: { width: number; height: number },
  target: { width: number; height: number },
  crop: Crop,
): { scale: number; left: number; top: number; width: number; height: number } {
  const cover = Math.max(target.width / source.width, target.height / source.height);
  const scale = cover * crop.zoom;
  const scaledW = source.width * scale;
  const scaledH = source.height * scale;
  return {
    scale,
    left: (scaledW - target.width) * crop.x,
    top: (scaledH - target.height) * crop.y,
    width: target.width,
    height: target.height,
  };
}
```

`left`/`top` are in *scaled* pixels — the offset of the card's window into
the enlarged photo. Both consumers below use it that way.

Add `crop: cropSchema.default(defaultCrop)` to `designInputSchema`
(`shared/api.ts:141`). The route already parses `back` from a JSON string
field on the multipart body (`server/routes/designs.ts:72`); do the same for
`crop`.

### 2. The server: `printFile` and the thumbnail

Refactor `server/lob.ts` so the crop is one function used by both files:

```ts
/** The card face, pre-rotation: the source cropped to the print size at `crop`. */
export async function cropToCard(source: Buffer, orientation: Orientation, crop: Crop): Promise<Buffer> {
  const size = PRINT_SIZES[orientation];
  // Honour EXIF first, then measure — the rect is computed on the upright image.
  const upright = await sharp(source, { failOn: "error" }).rotate().toBuffer();
  const meta = await sharp(upright).metadata();
  const rect = cropRect({ width: meta.width!, height: meta.height! }, size, crop);

  return sharp(upright)
    .resize(Math.round(meta.width! * rect.scale), Math.round(meta.height! * rect.scale))
    .extract({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: size.width,
      height: size.height,
    })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
}
```

`printFile(source, orientation, crop)` becomes `cropToCard` followed by the
existing quarter turn and density metadata. `storePostcardDesign` builds the
thumbnail from the *same cropped buffer* rather than re-cropping the
original — today the thumbnail has its own `fit: "cover"` call, which is a
second copy of the crop waiting to drift.

Rounding: `extract` refuses a rectangle that runs past the edge by one pixel.
Clamp `left` to `[0, resizedW - size.width]` and `top` likewise after
rounding.

### 3. The client: a draggable preview

Replace `object-fit: cover` on `.frontImage` with explicit geometry so the
browser draws exactly `cropRect`:

- The preview box (`.frontPreview`) has a known rendered size; measure it
  with a `ResizeObserver` (it changes with the orientation radio and on a
  phone).
- Compute `rect = cropRect(picked, previewSize, crop)`; render the `<img>`
  at `width: picked.width * rect.scale` and translate it by
  `(-rect.left, -rect.top)`. `overflow: hidden` on the box does the rest.
- **Drag**: pointer events on the box (`pointerdown` → `setPointerCapture`,
  `pointermove`, `pointerup`). Each move converts the pixel delta to a
  change in `x`/`y`: `dx = -movementX / (scaledW - boxW)`, clamped to 0..1.
  When the photo does not overflow on an axis (it fits exactly), that axis
  ignores the drag. Set `touch-action: none` on the box so a phone drags the
  photo rather than the page.
- **Zoom**: an antd `Slider` (1–3, step 0.05) under the orientation radio,
  labelled "Zoom". Keep `x`/`y` on zoom so the framing holds.
- **Keyboard**: the box is focusable (`tabIndex=0`, `role="img"` with an
  `aria-label` describing the control); arrow keys nudge by 0.02. This is
  what keeps the axe scan green and gives a keyboard user the feature.
- A one-line hint under the preview: "Drag to reposition." It disappears
  after the first drag.

Keep the drag maths in `src/lib/crop.ts` as pure functions
(`cropFromDrag(crop, delta, geometry)`) so they can be unit-tested without a
DOM.

Choosing a new photo resets `crop` to `defaultCrop`. Changing orientation
keeps it.

`useSaveDesign` (`src/lib/designs.ts`) appends `crop` as a JSON string field.

### Acceptance (A)

- A 3:1 panoramic photo can be pinned to its left edge, and the printed
  file's left column matches the original's left column.
- At `zoom: 1, x: 0.5, y: 0.5` the print file is byte-for-byte the same
  crop as before this change (the test below fixes that).
- The thumbnail and the print file show the same framing.
- Dragging on a phone moves the photo, not the page.
- Arrow keys move the photo with the preview focused.

## Part B · Collage layouts

### 1. Layouts, in `shared/postcards.ts`

A layout is a list of slots in unit fractions of the *portrait* card. The
landscape variant is the transpose — swap `x`/`y` and `w`/`h` — so one
definition serves both orientations.

```ts
export interface LayoutSlot { x: number; y: number; w: number; h: number }
export interface Layout { id: string; label: string; slots: LayoutSlot[] }

/** Inches of white kept around and between photos in a collage. */
export const COLLAGE_MARGIN_INCHES = 0.25; // bleed + safe area: nothing is trimmed
export const COLLAGE_GUTTER_INCHES = 0.1;

export const LAYOUTS: Layout[] = [
  { id: "single", label: "One photo", slots: [{ x: 0, y: 0, w: 1, h: 1 }] },
  { id: "two-stacked", label: "Two, stacked", slots: [/* top, bottom */] },
  { id: "two-side", label: "Two, side by side", slots: [/* left, right */] },
  { id: "one-two", label: "One big, two small", slots: [/* big top, two below */] },
  { id: "grid", label: "Four", slots: [/* 2×2 */] },
];
```

`single` is full-bleed and is exactly today's behaviour. Every other layout
lives inside the margin, with the gutter between slots; compute the slot
rectangles from the two constants rather than hard-coding fractions, so
changing the gutter changes every layout. A helper
`layoutSlotsPx(layout, orientation)` returns pixel rectangles at print size
and is used by the server and, scaled, by the preview.

### 2. The upload

`designInputSchema` gains `layout: z.enum(ids).default("single")` and
`slots: z.array(cropSchema).max(4)` — one crop per slot, in slot order. The
multipart field becomes `files` (multer `.array("files", 4)`); the count
must equal the layout's slot count or the route answers 400 with which slot
is empty. `uploadMiddleware` keeps its per-file size cap; `MAX_INPUT_PIXELS`
applies per file.

### 3. Composing the front

In `server/lob.ts`, `composeFront(files, layout, orientation, crops)`:

1. Start from a white card at `PRINT_SIZES[orientation]`
   (`sharp({ create: … background: "#ffffff" })`).
2. For each slot, `cropToCard`'s inner logic at the slot's pixel size
   rather than the card's — factor `cropToRect(source, {width, height}, crop)`
   out of Part A so the slot and the whole card use one function.
3. `composite` the slots at their `left`/`top`.
4. Then the existing rotation and density step.

`printFile` becomes the `single` case of `composeFront`. The thumbnail is
cut from the composed card.

### 4. The designer

- A layout picker above the preview: antd `Radio.Group` with `optionType=
  "button"`, each option a small inline SVG of the layout (five 24×36
  icons, drawn from the same slot fractions so they are never wrong).
- The preview draws the layout: one `.slot` box per slot, positioned from
  `layoutSlotsPx` scaled to the preview; each is its own drop target with
  the Part A drag/zoom, an "Add photo" button when empty, and a "Replace"
  affordance when filled. The safe-area frame stays.
- "Save this design" is enabled when every slot has a photo.
- On a phone the picker sits above the preview and the slots are still
  draggable; the icons make the picker usable at 44px targets.

`useSaveDesign` sends `files[]`, `layout`, `slots`.

### Acceptance (B)

- Each of the five layouts produces a print file whose slot centres carry
  the expected image (test with four solid-colour PNGs and sample pixels).
- No photo pixel lies within 0.25 in of the card edge in any layout except
  `single`.
- A layout with an empty slot cannot be saved, and the server refuses it
  with a message naming the slot.
- The thumbnail matches the composed card.

## Tests to add

- `shared/postcards.test.ts`: `cropRect` at the centre equals the old
  centre crop; at `x: 0` the left is 0; zoom doubles the scale;
  `layoutSlotsPx` keeps every slot inside the margin and the transpose is
  exact.
- `server/lob.test.ts` already builds synthetic images; add a two-colour
  image (left half red, right half blue) and assert `cropToCard` at `x: 0`
  is all red and at `x: 1` is all blue, at both orientations. Add the
  five-layout pixel-sampling test for B.
- `src/lib/crop.test.ts`: drag deltas clamp, and an axis with no overflow
  ignores movement.
- e2e: upload, drag the preview by 100px, save, and assert the thumbnail's
  `src` differs from a centre-crop save of the same file (or, simpler,
  assert the request body carried a non-default crop).

## Out of scope

- Editing a design after it is saved. The original is not kept; that is a
  storage decision worth its own brief if it comes up.
- Text, captions or stickers on the front.
- Filters and borders.
- More than four photos.
