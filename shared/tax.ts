import type { TaxBehavior } from "./schema.js";

/**
 * Tax helpers shared by the API, the admin and the storefront.
 *
 * Beluga calculates no tax of its own — Stripe Tax does all of it. What lives
 * here is the small amount of bookkeeping that has to agree on both sides of
 * the wire: which tax code a product effectively uses, and how to tell whether
 * what is published to Stripe still matches what the store has configured.
 */

/** A product's own tax code, or the store default when it has none. */
export function effectiveTaxCode(
  productTaxCode: string | null,
  storeDefaultTaxCode: string,
): string {
  return productTaxCode ?? storeDefaultTaxCode;
}

/**
 * The tax configuration a product was, or would be, published under.
 *
 * Recorded on publish and compared afterwards. It exists because
 * `tax_behavior` is immutable on a Stripe Price: a store that switches from
 * exclusive to inclusive pricing has every published Price wrong until new
 * ones are created, and nothing else in the data says so. Two fields in one
 * string rather than two columns, because it is only ever compared for
 * equality — never queried by part.
 */
export function taxSignature(taxCode: string, behavior: TaxBehavior): string {
  return `${taxCode}|${behavior}`;
}

/**
 * How a total's tax line should read.
 *
 * With exclusive pricing tax is a row that adds to the total. With inclusive
 * pricing the total already contains it, so a row that looks additive is
 * simply wrong — it reads as if the buyer is being charged twice.
 */
export function taxLineLabel(behavior: TaxBehavior): string {
  return behavior === "inclusive" ? "Includes tax" : "Tax";
}
