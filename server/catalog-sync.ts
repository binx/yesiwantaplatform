import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getDatabase } from "../db/client.js";
import { findProductBySlug, getSettings } from "../db/repository.js";
import type { Product } from "../shared/schema.js";
import { requireStripe } from "./stripe.js";

/**
 * Mirror a product into Stripe as a Product with one Price per variant.
 *
 * Two facts drive the whole design:
 *
 *   1. Stripe Prices are immutable. Changing an amount means creating a new
 *      Price and archiving the old one — you cannot edit `unit_amount`. Old
 *      Prices are archived rather than deleted so historic orders still
 *      resolve.
 *   2. Prices carry no inventory. Stock stays in our database, which is what
 *      v1 used the removed SKUs API for.
 *
 * Nothing is pushed until a product is published, so abandoning the editor
 * cannot leave orphaned objects in a live Stripe account — v1's step-by-step
 * wizard wrote to Stripe on every step and routinely did exactly that.
 */

async function setStripeProductId(productId: string, stripeProductId: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db
    .update(schema.products)
    .set({ stripeProductId })
    .where(eq(schema.products.id, productId));
}

async function setStripePriceId(variantId: string, stripePriceId: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db
    .update(schema.variants)
    .set({ stripePriceId })
    .where(eq(schema.variants.id, variantId));
}

/** Look up an existing Price, tolerating one that has been deleted upstream. */
async function fetchPrice(stripe: Stripe, priceId: string): Promise<Stripe.Price | null> {
  try {
    return await stripe.prices.retrieve(priceId);
  } catch {
    return null;
  }
}

export interface SyncResult {
  stripeProductId: string;
  pricesCreated: number;
  pricesReused: number;
  pricesArchived: number;
}

export async function syncProductToStripe(product: Product): Promise<SyncResult> {
  const stripe = requireStripe();
  const settings = await getSettings();
  const currency = (settings?.currency ?? "USD").toLowerCase();

  const description = product.description.trim();

  let stripeProductId = product.stripeProductId;

  if (stripeProductId) {
    await stripe.products.update(stripeProductId, {
      name: product.name,
      // Stripe rejects an empty string, so clear with null instead.
      description: description === "" ? null : description,
      active: product.isLive,
    });
  } else {
    const created = await stripe.products.create({
      name: product.name,
      ...(description === "" ? {} : { description }),
      active: product.isLive,
      metadata: { beluga_product_id: product.id },
    });
    stripeProductId = created.id;
    await setStripeProductId(product.id, stripeProductId);
  }

  let pricesCreated = 0;
  let pricesReused = 0;
  let pricesArchived = 0;

  for (const variant of product.variants) {
    const existing = variant.stripePriceId ? await fetchPrice(stripe, variant.stripePriceId) : null;

    // Reuse only when the amount and currency still match exactly.
    if (
      existing &&
      existing.active &&
      existing.unit_amount === variant.priceCents &&
      existing.currency === currency
    ) {
      pricesReused += 1;
      continue;
    }

    if (existing?.active) {
      // Archive rather than delete: past orders still reference this Price.
      await stripe.prices.update(existing.id, { active: false });
      pricesArchived += 1;
    }

    const price = await stripe.prices.create({
      product: stripeProductId,
      unit_amount: variant.priceCents,
      currency,
      ...(variant.label ? { nickname: variant.label } : {}),
      metadata: { beluga_variant_id: variant.id },
    });

    await setStripePriceId(variant.id, price.id);
    pricesCreated += 1;
  }

  return { stripeProductId, pricesCreated, pricesReused, pricesArchived };
}

export async function syncProductBySlug(slug: string): Promise<SyncResult> {
  const product = await findProductBySlug(slug, false);
  if (!product) throw new Error(`No product with slug "${slug}".`);
  return syncProductToStripe(product);
}

/** Hide a product in Stripe without deleting it, so orders stay resolvable. */
export async function archiveProductInStripe(stripeProductId: string): Promise<void> {
  const stripe = requireStripe();
  await stripe.products.update(stripeProductId, { active: false }).catch(() => undefined);
}
