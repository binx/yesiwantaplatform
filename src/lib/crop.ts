import { cropRect, type Crop } from "@shared/postcards";

/**
 * Moving the photo inside the card, as arithmetic on the crop.
 *
 * The preview box is `box` pixels; the photo is drawn at `cropRect`'s scale
 * and translated by its `left`/`top`. A drag changes `x` and `y` by the
 * pointer's movement as a fraction of the overflow on that axis, so the
 * picture follows the finger exactly; an axis with no overflow — the photo
 * fits it — ignores the drag. Pure, so it is tested without a DOM.
 */

export interface Box {
  width: number;
  height: number;
}

/** How the photo is drawn in the preview: its rendered size and offset. */
export function previewGeometry(source: Box, box: Box, crop: Crop) {
  const rect = cropRect(source, box, crop);
  return {
    width: rect.scaledWidth,
    height: rect.scaledHeight,
    left: rect.left,
    top: rect.top,
    overflowX: Math.max(0, rect.scaledWidth - box.width),
    overflowY: Math.max(0, rect.scaledHeight - box.height),
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Round so a run of nudges lands on a tidy number rather than 0.5600000000000001. */
const tidy = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The crop after the pointer moved by `(dx, dy)` pixels with the photo held.
 *
 * Dragging right shows more of the left edge, so `x` decreases; the sign is
 * the one that makes the picture stick to the pointer.
 */
export function cropFromDrag(crop: Crop, dx: number, dy: number, overflow: { overflowX: number; overflowY: number }): Crop {
  return {
    ...crop,
    x: overflow.overflowX > 0 ? tidy(clamp01(crop.x - dx / overflow.overflowX)) : crop.x,
    y: overflow.overflowY > 0 ? tidy(clamp01(crop.y - dy / overflow.overflowY)) : crop.y,
  };
}

/** A keyboard nudge: the arrow's direction is the way the photo moves. */
export function nudgeCrop(crop: Crop, key: string, step = 0.02): Crop | null {
  switch (key) {
    case "ArrowLeft":
      return { ...crop, x: tidy(clamp01(crop.x + step)) };
    case "ArrowRight":
      return { ...crop, x: tidy(clamp01(crop.x - step)) };
    case "ArrowUp":
      return { ...crop, y: tidy(clamp01(crop.y + step)) };
    case "ArrowDown":
      return { ...crop, y: tidy(clamp01(crop.y - step)) };
    default:
      return null;
  }
}
