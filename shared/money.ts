/**
 * All money in Beluga is an integer number of minor units (cents for USD).
 *
 * v1 stored prices as floats and multiplied by 100 at the boundary, which
 * produced non-integer cent amounts in Stripe: `19.99 * 100` is
 * `1998.9999999999998`. Never reintroduce a float here.
 */

export type Cents = number;

/** Parse user-entered currency text ("19.99", "$1,200") into integer cents. */
export function parseCents(input: string): Cents | null {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;

  const negative = cleaned.startsWith("-");
  const [whole = "", fraction = ""] = cleaned.replace("-", "").split(".");
  if (fraction.length > 2) return null;

  const digits = `${whole || "0"}${fraction.padEnd(2, "0")}`;
  const value = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(value)) return null;

  return negative ? -value : value;
}

/**
 * Render an amount in the store's own conventions.
 *
 * `locale` decides where the separators and the symbol go, and it is the
 * store's, never the buyer's: `de-DE` with EUR is `1.234,56 €` while `en-US`
 * with EUR is `€1,234.56`, and a shop's prices should read the same in every
 * screenshot of it. The default is what every caller formatted as before the
 * store carried a locale, so a two-argument call is unchanged.
 */
export function formatMoney(cents: Cents, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

/**
 * Render a price range for a product with several variants.
 * Returns null for an empty list rather than `$∞ - -$∞`, which is what v1
 * produced via `Math.min(...[])` on a product with no prices.
 */
export function formatPriceRange(
  prices: readonly Cents[],
  currency = "USD",
  locale = "en-US",
): string | null {
  if (prices.length === 0) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);

  return min === max
    ? formatMoney(min, currency, locale)
    : `${formatMoney(min, currency, locale)} – ${formatMoney(max, currency, locale)}`;
}
