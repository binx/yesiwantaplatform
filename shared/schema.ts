import { z } from "zod";

/**
 * The Beluga store contract.
 *
 * Both the client and the API validate against these schemas, so the data
 * source can change underneath without touching components. Phase 1 reads a
 * fixture; Phase 2 reads the database; the shapes are identical.
 */

/** Integer minor units. See shared/money.ts — never a float. */
export const centsSchema = z.number().int().min(0);

export const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase, hyphen-separated slug");

export const imageSchema = z.object({
  /** Path relative to the store's asset root. Always the full-size file. */
  path: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Required so product imagery is never invisible to screen readers. */
  alt: z.string(),
  /**
   * Widths of the resized copies that exist alongside `path`, for `srcset`.
   *
   * Recorded rather than assumed: an image uploaded before derivatives existed
   * has none, and advertising a file that is not there costs a 404 per card.
   * Empty means "serve the single full-size file", which is what every image
   * did before this field.
   */
  widths: z.array(z.number().int().positive()).default([]),
});

/**
 * Inventory lives in Beluga, not Stripe — Stripe Prices have no inventory
 * concept, which is why v1 leaned on the removed SKUs API for stock.
 */
export const inventorySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("infinite") }),
  z.object({ type: z.literal("finite"), quantity: z.number().int().min(0) }),
]);

/** A priced, separately-stocked version of a product. Becomes a Stripe Price. */
export const variantSchema = z.object({
  id: z.string().min(1),
  /** Shown in the variant picker, e.g. "Medium". Empty for single-variant products. */
  label: z.string(),
  priceCents: centsSchema,
  inventory: inventorySchema,
  /** Set once the variant has been pushed to Stripe. */
  stripePriceId: z.string().nullable().default(null),
});

/**
 * A choice that does not affect price or stock, e.g. gift wrap.
 * v1 called this `details` and stored it alongside priced SKU attributes,
 * which made the two easy to confuse.
 */
export const optionGroupSchema = z.object({
  name: z.string().min(1),
  choices: z.array(z.string().min(1)).min(1),
});

export const productSchema = z.object({
  id: z.string().min(1),
  slug: slugSchema,
  name: z.string().min(1),
  description: z.string().default(""),
  bulletPoints: z.array(z.string()).default([]),
  images: z.array(imageSchema).default([]),
  /** Label for the variant axis, e.g. "size". Null when there is one variant. */
  variantName: z.string().nullable().default(null),
  variants: z.array(variantSchema).min(1),
  optionGroups: z.array(optionGroupSchema).default([]),
  /** Draft products are editable but absent from the storefront. */
  isLive: z.boolean().default(false),
  stripeProductId: z.string().nullable().default(null),
});

export const collectionSchema = z.object({
  id: z.string().min(1),
  slug: slugSchema,
  name: z.string().min(1),
  cover: imageSchema.nullable().default(null),
  /** Product ids, in display order. */
  productIds: z.array(z.string()).default([]),
});

export const themeSchema = z.object({
  colorPrimary: z.string(),
  colorAccent: z.string(),
  fontFamily: z.string(),
  /** Corner radius in px; 0 reads as a harder, more editorial look. */
  borderRadius: z.number().int().min(0).max(24),
});

export const storeSchema = z.object({
  name: z.string().min(1),
  /** Publishable key only. The secret key must never reach the client. */
  stripePublishableKey: z.string().nullable().default(null),
  currency: z.string().length(3).default("USD"),
  theme: themeSchema,
  aboutText: z.string().nullable().default(null),
  collections: z.array(collectionSchema).default([]),
  products: z.array(productSchema).default([]),
});

/**
 * Beluga's default look.
 *
 * v1 shipped Material's rounded mid-grey defaults. v2 aims at an independent
 * shop: near-black ink, a warm accent, and a 2px radius so cards and buttons
 * read as crisp rather than pill-shaped. Every value is overridable per store.
 *
 * It lives here rather than in the client because the setup CLI and the setup
 * API both need it before any browser is involved.
 */
export const defaultTheme: Theme = {
  colorPrimary: "#18181b",
  colorAccent: "#e07a5f",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
  borderRadius: 2,
};

/** Featured products are a normal collection at this reserved slug. */
export const FEATURED_SLUG = "featured-products";

export type Cents = z.infer<typeof centsSchema>;
export type Image = z.infer<typeof imageSchema>;
export type Inventory = z.infer<typeof inventorySchema>;
export type Variant = z.infer<typeof variantSchema>;
export type OptionGroup = z.infer<typeof optionGroupSchema>;
export type Product = z.infer<typeof productSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type Store = z.infer<typeof storeSchema>;
