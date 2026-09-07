import { useMemo } from "react";
import type { Image, Product, Variant } from "@shared/schema";
import type { Cents } from "@shared/money";
import { useCart, type CartLine } from "@/store/cart";
import { useStore } from "./useStore";

export interface ResolvedLine {
  index: number;
  line: CartLine;
  product: Product;
  variant: Variant;
  image: Image | null;
  unitPriceCents: Cents;
  lineTotalCents: Cents;
  /** Null when the variant is unlimited. */
  stock: number | null;
}

export interface ResolvedCart {
  lines: ResolvedLine[];
  subtotalCents: Cents;
  /** Lines whose product or variant no longer exists in the catalogue. */
  orphanedCount: number;
}

/**
 * Join the stored cart against the current catalogue.
 *
 * Prices are read from the catalogue every render rather than from storage, so
 * a price change is reflected immediately and a deleted product drops out of
 * the cart instead of rendering `$NaN`.
 */
export function useCartLines(): ResolvedCart {
  const store = useStore();
  const lines = useCart((s) => s.lines);

  return useMemo(() => {
    const resolved: ResolvedLine[] = [];
    let orphanedCount = 0;

    lines.forEach((line, index) => {
      const product = store.products.find((p) => p.id === line.productId);
      const variant = product?.variants.find((v) => v.id === line.variantId);

      if (!product || !variant || !product.isLive) {
        orphanedCount += 1;
        return;
      }

      resolved.push({
        index,
        line,
        product,
        variant,
        image: product.images[0] ?? null,
        unitPriceCents: variant.priceCents,
        lineTotalCents: variant.priceCents * line.quantity,
        stock: variant.inventory.type === "finite" ? variant.inventory.quantity : null,
      });
    });

    return {
      lines: resolved,
      subtotalCents: resolved.reduce((sum, l) => sum + l.lineTotalCents, 0),
      orphanedCount,
    };
  }, [lines, store.products]);
}
