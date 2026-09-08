import { describe, expect, it } from "vitest";
import {
  SHIPPABLE_COUNTRIES,
  countriesCovered,
  findCoverageGaps,
  hasCatchAllZone,
  parcelWeight,
  resolveShippingRates,
  zoneForCountry,
  type ShippingRate,
  type ShippingZone,
} from "./shipping.js";

/**
 * Shipping resolution.
 *
 * This is the whole of tiers 1 and 2 — everything else is storage and forms.
 * The cases that matter are the ones that cost a shop money silently: a cart
 * that matches no rate and ships free, or a rate from the wrong zone.
 */

const zone = (over: Partial<ShippingZone> & { id: string }): ShippingZone => ({
  name: over.id,
  countryCodes: [],
  position: 0,
  ...over,
});

const rate = (over: Partial<ShippingRate> & { id: string }): ShippingRate => ({
  name: over.id,
  priceCents: 500,
  zoneId: null,
  minWeightGrams: null,
  maxWeightGrams: null,
  minSubtotalCents: null,
  maxSubtotalCents: null,
  taxBehavior: "exclusive",
  isActive: true,
  position: 0,
  ...over,
});

const ZONES: ShippingZone[] = [
  zone({ id: "dom", name: "Domestic", countryCodes: ["US"], position: 0 }),
  zone({ id: "eu", name: "Europe", countryCodes: ["GB", "IE", "DE"], position: 1 }),
  zone({ id: "row", name: "Rest of world", countryCodes: [], position: 2 }),
];

describe("zoneForCountry", () => {
  it("matches an explicit listing", () => {
    expect(zoneForCountry(ZONES, "GB")?.id).toBe("eu");
  });

  it("is case-insensitive about the code", () => {
    expect(zoneForCountry(ZONES, "gb")?.id).toBe("eu");
  });

  it("falls back to the catch-all for an unlisted country", () => {
    expect(zoneForCountry(ZONES, "JP")?.id).toBe("row");
  });

  it("prefers an explicit zone over a catch-all that sorts earlier", () => {
    // The catch-all is first by position, but naming a country must still win —
    // otherwise adding "rest of world" silently reprices every domestic order.
    const zones = [
      zone({ id: "row", countryCodes: [], position: 0 }),
      zone({ id: "dom", countryCodes: ["US"], position: 1 }),
    ];
    expect(zoneForCountry(zones, "US")?.id).toBe("dom");
  });

  it("returns null when nothing covers the country", () => {
    const zones = [zone({ id: "dom", countryCodes: ["US"] })];
    expect(zoneForCountry(zones, "JP")).toBeNull();
  });
});

describe("resolveShippingRates", () => {
  const parcel = { weightGrams: 300, subtotalCents: 2000 };

  it("applies an unzoned rate everywhere, so a flat-rate store needs no zones", () => {
    const rates = [rate({ id: "flat", priceCents: 499 })];
    expect(resolveShippingRates(rates, [], "JP", parcel).map((r) => r.id)).toEqual(["flat"]);
  });

  it("keeps a zoned rate out of other zones", () => {
    const rates = [
      rate({ id: "us-only", zoneId: "dom" }),
      rate({ id: "eu-only", zoneId: "eu" }),
    ];
    expect(resolveShippingRates(rates, ZONES, "GB", parcel).map((r) => r.id)).toEqual(["eu-only"]);
  });

  it("skips inactive rates", () => {
    const rates = [rate({ id: "off", isActive: false })];
    expect(resolveShippingRates(rates, ZONES, "US", parcel)).toEqual([]);
  });

  it("sorts cheapest first", () => {
    const rates = [
      rate({ id: "express", priceCents: 1200 }),
      rate({ id: "standard", priceCents: 400 }),
    ];
    expect(resolveShippingRates(rates, ZONES, "US", parcel).map((r) => r.id)).toEqual([
      "standard",
      "express",
    ]);
  });

  describe("weight bands", () => {
    const rates = [
      rate({ id: "light", maxWeightGrams: 500, priceCents: 300 }),
      rate({ id: "heavy", minWeightGrams: 501, priceCents: 900 }),
    ];

    it("picks the band the parcel falls in", () => {
      expect(
        resolveShippingRates(rates, ZONES, "US", { weightGrams: 300, subtotalCents: 0 }).map(
          (r) => r.id,
        ),
      ).toEqual(["light"]);

      expect(
        resolveShippingRates(rates, ZONES, "US", { weightGrams: 900, subtotalCents: 0 }).map(
          (r) => r.id,
        ),
      ).toEqual(["heavy"]);
    });

    it("treats bounds as inclusive", () => {
      expect(
        resolveShippingRates(rates, ZONES, "US", { weightGrams: 500, subtotalCents: 0 }).map(
          (r) => r.id,
        ),
      ).toEqual(["light"]);
    });

    it("still matches a weightless cart when the store has set no weights", () => {
      // A store that never fills in weights must not lose its shipping options.
      expect(
        resolveShippingRates([rate({ id: "flat" })], ZONES, "US", {
          weightGrams: 0,
          subtotalCents: 0,
        }),
      ).toHaveLength(1);
    });
  });

  describe("subtotal bands", () => {
    const rates = [
      rate({ id: "paid", maxSubtotalCents: 4999, priceCents: 600 }),
      rate({ id: "free-over-50", minSubtotalCents: 5000, priceCents: 0 }),
    ];

    it("charges below the threshold", () => {
      expect(
        resolveShippingRates(rates, ZONES, "US", { weightGrams: 0, subtotalCents: 4000 }).map(
          (r) => r.id,
        ),
      ).toEqual(["paid"]);
    });

    it("is free at and above the threshold", () => {
      expect(
        resolveShippingRates(rates, ZONES, "US", { weightGrams: 0, subtotalCents: 5000 }).map(
          (r) => r.id,
        ),
      ).toEqual(["free-over-50"]);
    });
  });

  it("returns nothing rather than inventing a price when there is a gap", () => {
    // Silence is the caller's problem to handle; a made-up rate would be worse.
    const rates = [rate({ id: "light", maxWeightGrams: 500 })];
    expect(
      resolveShippingRates(rates, ZONES, "US", { weightGrams: 5000, subtotalCents: 0 }),
    ).toEqual([]);
  });
});

describe("parcelWeight", () => {
  it("multiplies by quantity", () => {
    expect(
      parcelWeight([
        { weightGrams: 250, quantity: 2 },
        { weightGrams: 100, quantity: 3 },
      ]),
    ).toBe(800);
  });

  it("treats a negative weight as zero rather than subtracting", () => {
    expect(parcelWeight([{ weightGrams: -500, quantity: 1 }])).toBe(0);
  });
});

describe("coverage", () => {
  it("lists every country any zone names, deduplicated and sorted", () => {
    expect(countriesCovered(ZONES)).toEqual(["DE", "GB", "IE", "US"]);
  });

  it("reports whether unlisted countries are priced at all", () => {
    expect(hasCatchAllZone(ZONES)).toBe(true);
    expect(hasCatchAllZone([zone({ id: "dom", countryCodes: ["US"] })])).toBe(false);
  });

  it("names the countries a cart would ship free from", () => {
    // "Europe" has no rate at all, so a GB buyer is offered nothing.
    const rates = [rate({ id: "us", zoneId: "dom" }), rate({ id: "row", zoneId: "row" })];

    const gaps = findCoverageGaps(rates, ZONES, { weightGrams: 100, subtotalCents: 1000 });

    expect(gaps.map((g) => g.countryCode)).toEqual(["DE", "GB", "IE"]);
    expect(gaps[0]?.zoneName).toBe("Europe");
  });

  it("reports no gaps when every zone is priced", () => {
    const rates = [rate({ id: "everywhere" })];
    expect(findCoverageGaps(rates, ZONES, { weightGrams: 100, subtotalCents: 1000 })).toEqual([]);
  });
});

describe("SHIPPABLE_COUNTRIES", () => {
  it("is Stripe's list, so nothing offered can be rejected at session creation", () => {
    expect(SHIPPABLE_COUNTRIES).toContain("US");
    expect(SHIPPABLE_COUNTRIES).toContain("JP");
    // Sanctioned territories Stripe will not accept must not be offered — the
    // failure would land after the buyer has filled in their cart.
    expect(SHIPPABLE_COUNTRIES).not.toContain("KP");
    expect(SHIPPABLE_COUNTRIES).not.toContain("IR");
  });

  it("is sorted and free of duplicates", () => {
    expect([...SHIPPABLE_COUNTRIES]).toEqual([...new Set(SHIPPABLE_COUNTRIES)].sort());
  });
});
