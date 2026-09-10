import { describe, expect, it } from "vitest";
import { defaultCrop } from "@shared/postcards";
import { cropFromDrag, nudgeCrop, previewGeometry } from "./crop";

/**
 * The drag arithmetic, without a DOM.
 */
describe("previewGeometry", () => {
  it("draws a wide photo taller than the box with horizontal overflow only", () => {
    const geometry = previewGeometry({ width: 4000, height: 1000 }, { width: 200, height: 300 }, defaultCrop);
    expect(geometry.height).toBe(300);
    expect(geometry.width).toBe(1200);
    expect(geometry.overflowX).toBe(1000);
    expect(geometry.overflowY).toBe(0);
    // Centred: half the overflow is hidden on the left.
    expect(geometry.left).toBe(500);
    expect(geometry.top).toBe(0);
  });
});

describe("cropFromDrag", () => {
  const overflow = { overflowX: 1000, overflowY: 0 };

  it("follows the pointer: dragging right shows more of the left edge", () => {
    expect(cropFromDrag(defaultCrop, 100, 0, overflow).x).toBe(0.4);
    expect(cropFromDrag(defaultCrop, -100, 0, overflow).x).toBe(0.6);
  });

  it("clamps at the edges", () => {
    expect(cropFromDrag(defaultCrop, 5000, 0, overflow).x).toBe(0);
    expect(cropFromDrag(defaultCrop, -5000, 0, overflow).x).toBe(1);
  });

  it("ignores an axis with no overflow", () => {
    const moved = cropFromDrag(defaultCrop, 0, 80, overflow);
    expect(moved.y).toBe(0.5);
  });

  it("keeps the zoom", () => {
    expect(cropFromDrag({ ...defaultCrop, zoom: 2 }, 10, 0, overflow).zoom).toBe(2);
  });
});

describe("nudgeCrop", () => {
  it("moves the photo the way the arrow points, on tidy numbers", () => {
    let crop = defaultCrop;
    for (let i = 0; i < 3; i += 1) crop = nudgeCrop(crop, "ArrowLeft")!;
    expect(crop.x).toBe(0.56);
    expect(nudgeCrop(crop, "ArrowRight")!.x).toBe(0.54);
    expect(nudgeCrop(crop, "ArrowUp")!.y).toBe(0.52);
    expect(nudgeCrop(crop, "ArrowDown")!.y).toBe(0.48);
  });

  it("clamps and ignores other keys", () => {
    expect(nudgeCrop({ ...defaultCrop, x: 0.99 }, "ArrowLeft")!.x).toBe(1);
    expect(nudgeCrop(defaultCrop, "Enter")).toBeNull();
  });
});
