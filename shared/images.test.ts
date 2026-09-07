import { describe, expect, it } from "vitest";
import { buildSrcSet, derivativePath, derivativeWidthsFor } from "./images.js";

/**
 * The derivative naming rule.
 *
 * The server writes these files and the storefront advertises them, and
 * nothing type-checks that the two agree — a mismatch is a 404 per image at
 * runtime, not a compile error. That is the whole reason the rule is shared,
 * and the reason it is worth pinning here.
 */

describe("derivativePath", () => {
  it("inserts the width before the extension", () => {
    expect(derivativePath("abc.webp", 800)).toBe("abc-800.webp");
  });

  it("keeps the directory intact", () => {
    expect(derivativePath("product-id/abc.webp", 400)).toBe("product-id/abc-400.webp");
  });

  it("appends when there is no extension", () => {
    expect(derivativePath("abc", 400)).toBe("abc-400");
  });

  it("does not mistake a dot in a directory for an extension", () => {
    // "v1.2/abc" has a dot, but it is not the filename's.
    expect(derivativePath("v1.2/abc", 400)).toBe("v1.2/abc-400");
  });
});

describe("derivativeWidthsFor", () => {
  it("never upscales", () => {
    // A 500px source gets one derivative, not four blown-up ones.
    expect(derivativeWidthsFor(500)).toEqual([400]);
  });

  it("returns nothing for an image smaller than the smallest step", () => {
    expect(derivativeWidthsFor(320)).toEqual([]);
  });

  it("stops at the source width rather than matching it", () => {
    // Generating an 800px copy of an 800px original is pure duplication.
    expect(derivativeWidthsFor(800)).toEqual([400]);
  });

  it("offers the full ladder for a large upload", () => {
    expect(derivativeWidthsFor(2400)).toEqual([400, 800, 1200, 1600]);
  });
});

describe("buildSrcSet", () => {
  const url = (path: string) => `/assets/${path}`;

  it("is null when there are no derivatives, so `sizes` stays inert", () => {
    // An image uploaded before derivatives existed must not advertise files
    // that are not on disk.
    expect(buildSrcSet({ path: "a.webp", width: 900, widths: [] }, url)).toBeNull();
  });

  it("lists every derivative plus the full-size original at its own width", () => {
    expect(buildSrcSet({ path: "p/a.webp", width: 2400, widths: [400, 800] }, url)).toBe(
      "/assets/p/a-400.webp 400w, /assets/p/a-800.webp 800w, /assets/p/a.webp 2400w",
    );
  });
});
