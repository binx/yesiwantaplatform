import { describe, expect, it } from "vitest";
import {
  findDuplicateCombination,
  optionSelectionsAreWellFormed,
  regenerateLabel,
} from "./product-options.js";

describe("regenerateLabel", () => {
  it("joins the selected values in axis order", () => {
    expect(regenerateLabel(["Small", "Blue"])).toBe("Small / Blue");
  });

  it("is empty for a product with no axes", () => {
    expect(regenerateLabel([])).toBe("");
  });
});

describe("optionSelectionsAreWellFormed", () => {
  const options = [
    { name: "Size", values: ["Small", "Large"] },
    { name: "Colour", values: ["Red", "Blue"] },
  ];

  it("accepts a variant naming one real value per axis", () => {
    expect(optionSelectionsAreWellFormed(options, [{ optionValues: ["Small", "Red"] }])).toBe(true);
  });

  it("rejects a variant missing a value for an axis", () => {
    expect(optionSelectionsAreWellFormed(options, [{ optionValues: ["Small"] }])).toBe(false);
  });

  it("rejects a variant naming a value that belongs to no axis", () => {
    expect(optionSelectionsAreWellFormed(options, [{ optionValues: ["Small", "Green"] }])).toBe(false);
  });

  it("accepts an empty selection when the product has no options", () => {
    expect(optionSelectionsAreWellFormed([], [{ optionValues: [] }])).toBe(true);
  });
});

describe("findDuplicateCombination", () => {
  it("finds the first repeated combination", () => {
    const duplicate = findDuplicateCombination([
      { optionValues: ["Small", "Red"] },
      { optionValues: ["Small", "Blue"] },
      { optionValues: ["Small", "Red"] },
    ]);

    expect(duplicate).toEqual(["Small", "Red"]);
  });

  it("returns null when every combination is unique", () => {
    const duplicate = findDuplicateCombination([
      { optionValues: ["Small", "Red"] },
      { optionValues: ["Small", "Blue"] },
    ]);

    expect(duplicate).toBeNull();
  });

  it("treats a second variant with no options as a duplicate of the first", () => {
    // A product with no options can only ever have one price.
    const duplicate = findDuplicateCombination([{ optionValues: [] }, { optionValues: [] }]);
    expect(duplicate).toEqual([]);
  });
});
