/**
 * How a resized copy of an image is named.
 *
 * The server writes the derivatives and the storefront advertises them in
 * `srcset`, and nothing checks that the two agree — a mismatch is not a type
 * error, it is a 404 per image at runtime. So the rule lives here, imported by
 * both, rather than being written out twice.
 */

/** `products/abc.webp` at width 800 becomes `products/abc-800.webp`. */
export function derivativePath(fullPath: string, width: number): string {
  const dot = fullPath.lastIndexOf(".");
  const slash = fullPath.lastIndexOf("/");

  // A dot before the last slash belongs to a directory, not to the filename.
  if (dot === -1 || dot < slash) return `${fullPath}-${width}`;

  return `${fullPath.slice(0, dot)}-${width}${fullPath.slice(dot)}`;
}

/**
 * The widths generated for a source image.
 *
 * Roughly a 1.5–2× step, which is about where the browser's choice stops being
 * wasteful without producing a file per plausible layout. Nothing wider than
 * the source is generated — upscaling costs bytes and adds no detail — so a
 * small upload simply yields fewer derivatives.
 */
export const DERIVATIVE_WIDTHS = [400, 800, 1200, 1600] as const;

export function derivativeWidthsFor(sourceWidth: number): number[] {
  return DERIVATIVE_WIDTHS.filter((width) => width < sourceWidth);
}

/**
 * The `srcset` value for an image, or null when it has no derivatives.
 *
 * Null rather than an empty string: `srcset=""` is not the same as no
 * attribute, and `sizes` without a `srcset` to choose from does nothing.
 */
export function buildSrcSet(
  image: { path: string; width: number; widths: number[] },
  toUrl: (path: string) => string,
): string | null {
  if (image.widths.length === 0) return null;

  return [
    ...image.widths.map((width) => `${toUrl(derivativePath(image.path, width))} ${width}w`),
    `${toUrl(image.path)} ${image.width}w`,
  ].join(", ");
}
