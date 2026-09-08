/**
 * Pure helpers for priced variant axes, shared by the admin route (which must
 * validate what the schema alone cannot) and the product editor (which wants
 * the same answer before a save is even attempted).
 */

export interface OptionShape {
  name: string;
  values: string[];
}

export interface VariantOptionsShape {
  optionValues: string[];
}

/**
 * "Small / Blue" — the denormalised display label, regenerated from the
 * selected value on each axis, in axis order. Ignores axis names: v1's
 * labels were value-only, and this preserves that.
 */
export function regenerateLabel(optionValues: string[]): string {
  return optionValues.join(" / ");
}

/**
 * Every variant must name exactly one value per axis, and that value must
 * actually belong to the axis it is named against.
 */
export function optionSelectionsAreWellFormed(
  options: OptionShape[],
  variants: VariantOptionsShape[],
): boolean {
  return variants.every(
    (variant) =>
      variant.optionValues.length === options.length &&
      variant.optionValues.every((value, index) => options[index]?.values.includes(value)),
  );
}

/** The first duplicated combination of axis values, or null if all are unique. */
export function findDuplicateCombination(
  variants: VariantOptionsShape[],
): string[] | null {
  const seen = new Set<string>();

  for (const variant of variants) {
    const key = JSON.stringify(variant.optionValues);
    if (seen.has(key)) return variant.optionValues;
    seen.add(key);
  }

  return null;
}
