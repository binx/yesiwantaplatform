import { Router } from "express";
import { shippingQuoteInputSchema } from "../../shared/api.js";
import {
  parcelFor,
  requiresShipping,
  resolveShippingRates,
  type ShippingLine,
} from "../../shared/shipping.js";
import type { TaxBehavior } from "../../shared/schema.js";
import { getShippingTable, variantWeights } from "../../db/shipping-repository.js";
import { listProducts } from "../../db/repository.js";
import { httpError, writeRateLimit } from "../middleware.js";

/**
 * Shipping quotes for the cart page.
 *
 * Public, and deliberately built from identifiers only: the client sends
 * products, variants and quantities, and the weight and subtotal are read from
 * the catalogue here. That is the same rule the checkout route follows, and it
 * is what makes the price shown on the cart the price actually charged —
 * `quoteShipping` is the single implementation both call.
 */
export const shippingRouter: Router = Router();

export interface QuotedRate {
  id: string;
  name: string;
  priceCents: number;
  /** Whether the price already contains tax; passed to Stripe at checkout. */
  taxBehavior: TaxBehavior;
}

export interface ShippingQuote {
  rates: QuotedRate[];
  /** Physical lines only — see `parcelFor` in shared/shipping.ts. */
  weightGrams: number;
  subtotalCents: number;
  /** True when the store priced this destination but nothing matched. */
  gap: boolean;
  /**
   * False for a cart of downloads only, which has nothing to post.
   *
   * The distinction the caller needs is not "no rates matched" but "no rates
   * should exist": a digital-only cart must reach Stripe with no address
   * collection at all, whereas an empty `rates` on a physical cart is a
   * coverage gap the merchant needs telling about.
   */
  requiresShipping: boolean;
}

/**
 * Resolve the rates a cart qualifies for.
 *
 * Shared with checkout rather than reimplemented, so the cart page and the
 * Stripe session can never disagree about what shipping costs.
 */
export async function quoteShipping(
  lines: readonly { productId: string; variantId: string; quantity: number }[],
  countryCode: string,
): Promise<ShippingQuote> {
  const [{ zones, rates }, { products }] = await Promise.all([
    getShippingTable(),
    listProducts({ liveOnly: true, limit: 200 }),
  ]);

  const byId = new Map(products.map((p) => [p.id, p]));
  const weights = await variantWeights(lines.map((l) => l.variantId));

  const priced: ShippingLine[] = [];

  for (const line of lines) {
    const product = byId.get(line.productId);
    const variant = product?.variants.find((v) => v.id === line.variantId);
    // An unknown line contributes nothing rather than throwing: a stale cart
    // should still get a quote for the items that are real.
    if (!product || !variant) continue;

    priced.push({
      weightGrams: weights.get(variant.id) ?? 0,
      quantity: line.quantity,
      priceCents: variant.priceCents,
      isDigital: product.kind === "digital",
    });
  }

  // Weight and subtotal both come from the physical lines only.
  const parcel = parcelFor(priced);
  const shippable = requiresShipping(priced);

  // Nothing to post: no rates, and — importantly — not a coverage gap either.
  // Running the matcher on an empty parcel would let a 0 g / $0 "parcel" match
  // the store's lightest band and offer postage on a cart of downloads.
  const matched = shippable
    ? resolveShippingRates(rates, zones, countryCode, parcel)
    : [];

  return {
    rates: matched.map(({ id, name, priceCents, taxBehavior }) => ({
      id,
      name,
      priceCents,
      taxBehavior,
    })),
    weightGrams: parcel.weightGrams,
    subtotalCents: parcel.subtotalCents,
    // Only a gap if the store has rates at all; a store with none has simply
    // not set shipping up, which is a different message.
    gap: shippable && matched.length === 0 && rates.length > 0,
    requiresShipping: shippable,
  };
}

shippingRouter.post("/shipping/quote", writeRateLimit, async (req, res) => {
  const parsed = shippingQuoteInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "That cart could not be read.");

  res.json(await quoteShipping(parsed.data.lines, parsed.data.countryCode));
});
