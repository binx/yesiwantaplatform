import { FEATURED_SLUG, type Collection, type Product, type Store } from "./schema.js";
import type { Cents } from "./money.js";

/**
 * Catalogue lookups shared by the storefront and the API.
 *
 * v1's `getProductsFromCollection` threw when a collection slug was missing and
 * emitted `undefined` entries for products that had since been deleted, which
 * then crashed whatever rendered them. These return empty rather than throwing.
 */

export function findCollection(store: Store, slug: string): Collection | undefined {
  return store.collections.find((c) => c.slug === slug);
}

export function findProduct(store: Store, slug: string): Product | undefined {
  return store.products.find((p) => p.slug === slug);
}

/** Live products in a collection, in the collection's order, skipping dangling ids. */
export function getCollectionProducts(store: Store, slug: string): Product[] {
  const collection = findCollection(store, slug);
  if (!collection) return [];

  const byId = new Map(store.products.map((p) => [p.id, p]));

  return collection.productIds
    .map((id) => byId.get(id))
    .filter((p): p is Product => p !== undefined && p.isLive);
}

export function getFeaturedProducts(store: Store): Product[] {
  return getCollectionProducts(store, FEATURED_SLUG);
}

/** Collections shown in navigation — everything except the reserved featured list. */
export function getVisibleCollections(store: Store): Collection[] {
  return store.collections.filter((c) => c.slug !== FEATURED_SLUG);
}

export function getLiveProducts(store: Store): Product[] {
  return store.products.filter((p) => p.isLive);
}

export function getProductPrices(product: Product): Cents[] {
  return product.variants.map((v) => v.priceCents);
}

/** How many units of a variant a shopper may still add. `null` means unlimited. */
export function availableStock(product: Product, variantId: string): number | null {
  const variant = product.variants.find((v) => v.id === variantId);
  if (!variant) return 0;
  return variant.inventory.type === "infinite" ? null : variant.inventory.quantity;
}

export function isSoldOut(product: Product): boolean {
  return product.variants.every(
    (v) => v.inventory.type === "finite" && v.inventory.quantity === 0,
  );
}
