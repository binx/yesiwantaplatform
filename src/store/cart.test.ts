import { beforeEach, describe, expect, it } from "vitest";
import { useCart, useCartCount } from "./cart";
import { renderHook } from "@testing-library/react";

const line = {
  designs: [{ designId: "d1", mailDate: "2026-10-01" }],
  recipients: [{ name: "Grandma", line1: "1 Main St", line2: null, city: "Marfa", state: "TX", postalCode: "79843" }],
};

beforeEach(() => {
  useCart.setState({ lines: [] });
});

describe("the cart", () => {
  it("counts every design to every recipient", () => {
    useCart.getState().add({ ...line, designs: [...line.designs, { designId: "d2", mailDate: "2026-10-08" }], recipients: [...line.recipients, line.recipients[0]!] });
    useCart.getState().add(line);
    const { result } = renderHook(() => useCartCount());
    expect(result.current).toBe(5);
  });

  it("ignores a remove that misses rather than dropping the last line", () => {
    useCart.getState().add(line);
    useCart.getState().remove(7);
    expect(useCart.getState().lines).toHaveLength(1);
  });

  it("drops a persisted line that no longer fits the schema", () => {
    const merged = useCart.persist.getOptions().merge!(
      { lines: [line, { designs: [], recipients: [] }, { nonsense: true }] },
      useCart.getState(),
    ) as { lines: unknown[] };
    expect(merged.lines).toEqual([line]);
  });
});
