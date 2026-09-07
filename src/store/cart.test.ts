import { beforeEach, describe, expect, it } from "vitest";
import { normalizeQuantity, useCart, type CartLine } from "./cart";

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "p1",
  variantId: "v1",
  quantity: 1,
  options: {},
  ...over,
});

beforeEach(() => {
  useCart.setState({ lines: [] });
});

describe("normalizeQuantity", () => {
  it("coerces the string values a number input actually emits", () => {
    // v1 wrote e.target.value straight into state, so clearing the field stored
    // "" and rendered $NaN, then posted quantity 0 to the order.
    expect(normalizeQuantity("3", null)).toBe(3);
    expect(normalizeQuantity("", null)).toBe(1);
    expect(normalizeQuantity(null, null)).toBe(1);
    expect(normalizeQuantity("abc", null)).toBe(1);
  });

  it("never drops below one", () => {
    expect(normalizeQuantity(0, null)).toBe(1);
    expect(normalizeQuantity(-5, null)).toBe(1);
  });

  it("floors fractional input", () => {
    expect(normalizeQuantity(2.9, null)).toBe(2);
  });

  it("clamps to available stock", () => {
    // The v1 product page let a shopper type 999 against 2 units in stock.
    expect(normalizeQuantity(999, 2)).toBe(2);
    expect(normalizeQuantity(1, 0)).toBe(1);
  });
});

describe("cart", () => {
  it("merges an identical line instead of duplicating it", () => {
    useCart.getState().add(line({ quantity: 1 }));
    useCart.getState().add(line({ quantity: 2 }));

    expect(useCart.getState().lines).toHaveLength(1);
    expect(useCart.getState().lines[0]?.quantity).toBe(3);
  });

  it("keeps different variants and options apart", () => {
    useCart.getState().add(line({ variantId: "v1" }));
    useCart.getState().add(line({ variantId: "v2" }));
    useCart.getState().add(line({ variantId: "v1", options: { "gift wrap": "Yes" } }));

    expect(useCart.getState().lines).toHaveLength(3);
  });

  it("ignores an out-of-range remove rather than deleting the last line", () => {
    // v1's delete modals ran splice(findIndex(...), 1) unchecked, so a missed
    // lookup passed -1 and silently removed the final entry.
    useCart.getState().add(line({ variantId: "v1" }));
    useCart.getState().add(line({ variantId: "v2" }));

    useCart.getState().remove(-1);
    useCart.getState().remove(99);

    expect(useCart.getState().lines).toHaveLength(2);
  });

  it("removes the addressed line", () => {
    useCart.getState().add(line({ variantId: "v1" }));
    useCart.getState().add(line({ variantId: "v2" }));

    useCart.getState().remove(0);

    expect(useCart.getState().lines).toHaveLength(1);
    expect(useCart.getState().lines[0]?.variantId).toBe("v2");
  });
});
