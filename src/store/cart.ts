import { create } from "zustand";
import { persist } from "zustand/middleware";
import { cartLineSchema, countPostcards, type CartLine } from "@shared/cart";

/**
 * The cart: a list of batches, each some designs going to some recipients.
 *
 * Holds design *ids*, dates and recipients — never a price or an image URL.
 * v1 wrote the price into localStorage alongside the line, so a price change
 * left stale amounts in every open cart. Everything displayable is derived
 * from settings and the designs API at render time instead.
 */

export type { CartLine } from "@shared/cart";

interface CartState {
  lines: CartLine[];
  add: (line: CartLine) => void;
  remove: (index: number) => void;
  clear: () => void;
  /** Replaces the cart wholesale — used to repopulate it from a recovered cart. */
  setLines: (lines: CartLine[]) => void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],

      add: (line) => set((state) => ({ lines: [...state.lines, line] })),

      // Guarded, unlike v1's `splice(findIndex(...), 1)`, which removed the
      // last item whenever the lookup missed.
      remove: (index) =>
        set((state) => {
          if (index < 0 || index >= state.lines.length) return { lines: state.lines };
          return { lines: state.lines.filter((_, i) => i !== index) };
        }),

      clear: () => set({ lines: [] }),

      setLines: (lines) => set({ lines }),
    }),
    {
      name: "postcards.cart",
      version: 1,
      /*
       * Parsed on the way back in, so a cart written by an older build — or
       * edited by hand — cannot put an unvalidated line in front of checkout.
       * A line that no longer fits the schema is dropped, not repaired.
       */
      merge: (persisted, current) => {
        const stored = (persisted as { lines?: unknown } | undefined)?.lines;
        const lines = Array.isArray(stored)
          ? stored
              .map((line) => cartLineSchema.safeParse(line))
              .filter((result) => result.success)
              .map((result) => result.data)
          : [];
        return { ...current, lines };
      },
    },
  ),
);

/** Total postcards in the cart — the number shown next to the Cart link. */
export function useCartCount(): number {
  return useCart((state) => countPostcards(state.lines));
}
