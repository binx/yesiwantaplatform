import { z } from "zod";
import { centsSchema } from "./schema.js";

/**
 * Shipping, tiers 1 and 2: flat rates and weight/zone tables.
 *
 * v1 modelled shipping as a magic Stripe SKU the browser picked, which meant
 * one flat price, no address awareness, and a `{name:"FREE", price:0}` fake SKU
 * in the checkout. This replaces it with rates a store configures, matched
 * against where the parcel is going, what it weighs, and what it costs.
 *
 * Live carrier rates are deliberately not here. They require
 * `ui_mode: 'elements'` — see docs/shipping.md — which means owning the
 * checkout page again. Everything below keeps Stripe's hosted checkout.
 */

/**
 * Every country Stripe Checkout will collect a shipping address for.
 *
 * Taken from `Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry`
 * in the pinned SDK, because Stripe is the authority on this and its list is
 * narrower than ISO 3166 — sanctioned territories are absent. Offering a
 * country Stripe rejects would fail session creation *after* the buyer has
 * filled in their cart, which is the worst possible moment.
 *
 * Used only when a store has a catch-all zone: without one, the choices are
 * exactly the countries its zones name.
 */
export const SHIPPABLE_COUNTRIES: readonly string[] = [
  "AC", "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AT", "AU", "AW", "AX",
  "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ",
  "BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CD", "CF", "CG", "CH", "CI", "CK", "CL",
  "CM", "CN", "CO", "CR", "CV", "CW", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC",
  "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FO", "FR", "GA", "GB", "GD", "GE",
  "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY",
  "HK", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IS", "IT", "JE",
  "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KR", "KW", "KY", "KZ", "LA", "LB",
  "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG",
  "MK", "ML", "MM", "MN", "MO", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF",
  "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PY", "QA", "RE", "RO", "RS", "RU",
  "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO",
  "SR", "SS", "ST", "SV", "SX", "SZ", "TA", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL",
  "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "US", "UY", "UZ", "VA", "VC",
  "VE", "VG", "VN", "VU", "WF", "WS", "XK", "YE", "YT", "ZA", "ZM", "ZW", "ZZ",
];

/** Two-letter ISO 3166-1 alpha-2, uppercase. */
export const countryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "must be a two-letter country code, like US or GB");

export const shippingZoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /**
   * Countries this zone covers. Empty means "everywhere else" — a catch-all,
   * so a store can price the world without listing it.
   */
  countryCodes: z.array(countryCodeSchema).default([]),
  position: z.number().int().min(0).default(0),
});

/**
 * A rate, optionally bounded by zone, parcel weight and order subtotal.
 *
 * Bounds are inclusive at both ends and `null` means unbounded. Inclusive is
 * the reading a shop owner expects from "up to 500 g"; the cost is that
 * touching bands both match, which shows the buyer two options rather than
 * silently dropping one. A gap is the dangerous case, not an overlap, so the
 * admin warns about carts that would match nothing.
 */
export const shippingRateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  priceCents: centsSchema,
  /** Null applies the rate in every zone. */
  zoneId: z.string().nullable().default(null),
  minWeightGrams: z.number().int().min(0).nullable().default(null),
  maxWeightGrams: z.number().int().min(0).nullable().default(null),
  /** `minSubtotalCents` is how "free over $50" is expressed. */
  minSubtotalCents: centsSchema.nullable().default(null),
  maxSubtotalCents: centsSchema.nullable().default(null),
  isActive: z.boolean().default(true),
  position: z.number().int().min(0).default(0),
});

export const shippingZoneInputSchema = shippingZoneSchema.omit({ id: true, position: true });
export const shippingRateInputSchema = shippingRateSchema.omit({ id: true, position: true });

export type CountryCode = z.infer<typeof countryCodeSchema>;
export type ShippingZone = z.infer<typeof shippingZoneSchema>;
export type ShippingRate = z.infer<typeof shippingRateSchema>;
export type ShippingZoneInput = z.infer<typeof shippingZoneInputSchema>;
export type ShippingRateInput = z.infer<typeof shippingRateInputSchema>;

/**
 * The zone a country falls in.
 *
 * Explicit listings win over the catch-all regardless of position, so adding a
 * "rest of world" zone can never quietly capture a country that a specific
 * zone already prices. Among explicit matches the earliest position wins.
 */
export function zoneForCountry(
  zones: readonly ShippingZone[],
  countryCode: string,
): ShippingZone | null {
  const code = countryCode.toUpperCase();
  const ordered = [...zones].sort((a, b) => a.position - b.position);

  const explicit = ordered.find((zone) => zone.countryCodes.includes(code));
  if (explicit) return explicit;

  return ordered.find((zone) => zone.countryCodes.length === 0) ?? null;
}

/** Every country any zone names, deduplicated — what a shopper may choose. */
export function countriesCovered(zones: readonly ShippingZone[]): CountryCode[] {
  return [...new Set(zones.flatMap((zone) => zone.countryCodes))].sort();
}

/** True when some zone is a catch-all, so unlisted countries are still priced. */
export function hasCatchAllZone(zones: readonly ShippingZone[]): boolean {
  return zones.some((zone) => zone.countryCodes.length === 0);
}

export interface ParcelSummary {
  /** Total weight of the cart. Zero when a store has not set any weights. */
  weightGrams: number;
  subtotalCents: number;
}

function withinBounds(value: number, min: number | null, max: number | null): boolean {
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

/**
 * The rates a given cart and destination qualify for, cheapest first.
 *
 * Returning every match rather than one lets the buyer choose, which is the
 * behaviour a "standard / express" pair needs. An empty result means the store
 * has a coverage gap; the caller decides what to do about it, because silently
 * inventing a price would be worse than offering none.
 */
export function resolveShippingRates(
  rates: readonly ShippingRate[],
  zones: readonly ShippingZone[],
  destinationCountry: string,
  parcel: ParcelSummary,
): ShippingRate[] {
  const zone = zoneForCountry(zones, destinationCountry);

  return rates
    .filter((rate) => {
      if (!rate.isActive) return false;

      // A rate pinned to a zone only applies in that zone; an unpinned rate
      // applies everywhere, which is what makes flat-rate stores work with no
      // zones configured at all.
      if (rate.zoneId !== null && rate.zoneId !== zone?.id) return false;

      if (!withinBounds(parcel.weightGrams, rate.minWeightGrams, rate.maxWeightGrams)) return false;
      if (!withinBounds(parcel.subtotalCents, rate.minSubtotalCents, rate.maxSubtotalCents)) {
        return false;
      }

      return true;
    })
    .sort((a, b) => a.priceCents - b.priceCents || a.position - b.position);
}

/** Total weight of a cart, in grams. */
export function parcelWeight(
  lines: readonly { weightGrams: number; quantity: number }[],
): number {
  return lines.reduce((total, line) => total + Math.max(0, line.weightGrams) * line.quantity, 0);
}

/**
 * Countries with no rate for a plausible cart.
 *
 * A gap is silent at checkout — the buyer is simply offered nothing and ships
 * free — so the admin surfaces it instead of waiting for an order to arrive
 * with no postage on it.
 */
export function findCoverageGaps(
  rates: readonly ShippingRate[],
  zones: readonly ShippingZone[],
  parcel: ParcelSummary,
): { countryCode: string; zoneName: string | null }[] {
  const countries = countriesCovered(zones);
  const gaps: { countryCode: string; zoneName: string | null }[] = [];

  for (const countryCode of countries) {
    if (resolveShippingRates(rates, zones, countryCode, parcel).length > 0) continue;
    gaps.push({ countryCode, zoneName: zoneForCountry(zones, countryCode)?.name ?? null });
  }

  return gaps;
}

/** "GB" → "United Kingdom", falling back to the code itself. */
export function countryName(code: string, locale?: string): string {
  try {
    return new Intl.DisplayNames([locale ?? "en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
