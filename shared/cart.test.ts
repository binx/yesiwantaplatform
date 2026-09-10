import { describe, expect, it } from "vitest";
import { countPostcards, countPostcardsByDestination } from "./cart.js";

const us = { name: "A", line1: "1 St", line2: null, city: "B", state: "CA", postalCode: "90210", country: "US" };
const ca = { ...us, name: "C", state: "QC", postalCode: "H2X 1K4", country: "CA" };

describe("counting a cart", () => {
  it("multiplies designs by recipients, and splits the product by destination", () => {
    const lines = [
      { designs: [{ designId: "a", mailDate: "2026-09-14" }, { designId: "b", mailDate: "2026-09-21" }], recipients: [us, ca, ca] },
      { designs: [{ designId: "c", mailDate: "2026-09-14" }], recipients: [us] },
    ];
    expect(countPostcards(lines)).toBe(7);
    expect(countPostcardsByDestination(lines)).toEqual({ domestic: 3, international: 4 });
    expect(countPostcardsByDestination([])).toEqual({ domestic: 0, international: 0 });
  });
});
