import { describe, expect, it } from "vitest";
import { formatMoney, formatPriceRange, parseCents } from "./money.js";

describe("parseCents", () => {
  it("parses plain decimals without float drift", () => {
    // v1 computed `19.99 * 100` = 1998.9999999999998 and sent that to Stripe.
    expect(parseCents("19.99")).toBe(1999);
    expect(parseCents("0.07")).toBe(7);
    expect(parseCents("1200")).toBe(120000);
  });

  it("tolerates currency formatting", () => {
    expect(parseCents("$1,200.00")).toBe(120000);
    expect(parseCents("$34")).toBe(3400);
  });

  it("pads a single decimal place", () => {
    expect(parseCents("5.5")).toBe(550);
  });

  it("rejects sub-cent precision rather than rounding silently", () => {
    expect(parseCents("1.005")).toBeNull();
  });

  it("rejects empty and non-numeric input", () => {
    expect(parseCents("")).toBeNull();
    expect(parseCents("abc")).toBeNull();
  });
});

describe("formatPriceRange", () => {
  it("returns null for a product with no prices", () => {
    // v1 rendered "$∞ - -$∞" here via Math.min(...[]).
    expect(formatPriceRange([])).toBeNull();
  });

  it("collapses a single distinct price", () => {
    expect(formatPriceRange([3400, 3400])).toBe("$34.00");
  });

  it("shows a range when prices differ", () => {
    expect(formatPriceRange([3400, 12000])).toBe("$34.00 – $120.00");
  });
});

describe("formatMoney", () => {
  it("formats integer cents", () => {
    expect(formatMoney(120000)).toBe("$1,200.00");
    expect(formatMoney(0)).toBe("$0.00");
  });
});
