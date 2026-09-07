import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * The cart holds identifiers and quantities only.
 *
 * v1 wrote the price and image into localStorage alongside the line, so a price
 * change left stale amounts in every open cart, and an undefined price wrote
 * `price: undefined` and rendered `$NaN`. Everything displayable is derived
 * from the current catalogue at render time instead.
 */
export interface CartLine {
  productId: string;
  variantId: string;
  quantity: number;
  /** Non-priced selections, e.g. { "gift wrap": "Yes" }. */
  options: Record<string, string>;
}

interface CartState {
  lines: CartLine[];
  add: (line: CartLine) => void;
  setQuantity: (index: number, quantity: number) => void;
  remove: (index: number) => void;
  clear: () => void;
}

/** Cart quantities are always whole numbers of at least one. */
export function normalizeQuantity(value: unknown, max: number | null): number {
  // Narrowed explicitly: antd's InputNumber hands back `number | null`, while a
  // raw <input type="number"> hands back a string, including "" when cleared.
  let parsed: number;
  if (typeof value === "number") parsed = value;
  else if (typeof value === "string") parsed = Number.parseInt(value, 10);
  else parsed = Number.NaN;

  if (!Number.isFinite(parsed)) return 1;

  const floored = Math.max(1, Math.floor(parsed));
  return max === null ? floored : Math.min(floored, Math.max(1, max));
}

function sameLine(a: CartLine, b: CartLine): boolean {
  if (a.productId !== b.productId || a.variantId !== b.variantId) return false;

  const aKeys = Object.keys(a.options).sort();
  const bKeys = Object.keys(b.options).sort();
  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every((key, i) => bKeys[i] === key && a.options[key] === b.options[key]);
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],

      add: (line) =>
        set((state) => {
          // Adding the same variant twice increments rather than duplicating.
          const existing = state.lines.findIndex((l) => sameLine(l, line));
          if (existing === -1) return { lines: [...state.lines, line] };

          const lines = [...state.lines];
          const current = lines[existing];
          if (!current) return { lines: state.lines };

          lines[existing] = { ...current, quantity: current.quantity + line.quantity };
          return { lines };
        }),

      setQuantity: (index, quantity) =>
        set((state) => {
          const current = state.lines[index];
          if (!current) return { lines: state.lines };

          const lines = [...state.lines];
          lines[index] = { ...current, quantity };
          return { lines };
        }),

      // Guarded, unlike v1's `splice(findIndex(...), 1)`, which removed the
      // last item whenever the lookup missed.
      remove: (index) =>
        set((state) => {
          if (index < 0 || index >= state.lines.length) return { lines: state.lines };
          return { lines: state.lines.filter((_, i) => i !== index) };
        }),

      clear: () => set({ lines: [] }),
    }),
    {
      name: "beluga.cart",
      version: 1,
      partialize: (state) => ({ lines: state.lines }),
    },
  ),
);

/** Total units in the cart — the number shown next to the Cart link. */
export function useCartCount(): number {
  return useCart((state) => state.lines.reduce((sum, line) => sum + line.quantity, 0));
}
