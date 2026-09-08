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

export type SortOrder = "featured" | "price-asc" | "price-desc" | "name";

/**
 * Fold a string to something worth comparing.
 *
 * Diacritics are stripped so "cafe" finds "Café" — a shopper types what is on
 * their keyboard, not what is on the label.
 */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function haystack(product: Product): string {
  return fold([product.name, product.description, ...product.bulletPoints].join(" "));
}

/**
 * Filter a catalogue by a free-text query.
 *
 * Every whitespace-separated term must match somewhere, so "blue tote" returns
 * the blue totes rather than everything blue plus everything tote-shaped.
 * An empty or whitespace-only query returns the input untouched, which keeps
 * the curated order intact when the box is cleared.
 */
export function searchProducts(products: Product[], query: string): Product[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return products;

  return products.filter((product) => {
    const text = haystack(product);
    return terms.every((term) => text.includes(term));
  });
}

/** The lowest price across a product's variants, which is what a grid shows. */
function lowestPrice(product: Product): Cents {
  return product.variants.reduce(
    (lowest, variant) => (variant.priceCents < lowest ? variant.priceCents : lowest),
    product.variants[0]?.priceCents ?? 0,
  );
}

/**
 * Order a catalogue.
 *
 * "featured" returns the input as-is, and is the default for a reason: the
 * server sorts by position then name, and a collection carries a curated order
 * that any re-sort would throw away. Sorting is a copy, never in place.
 */
export function sortProducts(products: Product[], by: SortOrder): Product[] {
  if (by === "featured") return products;

  const sorted = [...products];

  if (by === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }

  const direction = by === "price-asc" ? 1 : -1;
  // Array.prototype.sort is stable, so equal prices keep the curated order.
  sorted.sort((a, b) => (lowestPrice(a) - lowestPrice(b)) * direction);
  return sorted;
}
