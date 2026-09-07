import { describe, expect, it } from "vitest";
import { getCollectionProducts, getVisibleCollections, isSoldOut } from "./catalog.js";
import { storeSchema, type Product, type Store } from "./schema.js";

function product(id: string, over: Partial<Product> = {}): Product {
  return productSchemaDefaults({ id, ...over });
}

function productSchemaDefaults(over: Partial<Product> & { id: string }): Product {
  return {
    id: over.id,
    slug: over.slug ?? over.id,
    name: over.name ?? over.id,
    description: "",
    bulletPoints: [],
    images: [],
    variantName: null,
    variants: over.variants ?? [
      { id: `${over.id}-v`, label: "", priceCents: 1000, inventory: { type: "infinite" }, weightGrams: 0, stripePriceId: null },
    ],
    optionGroups: [],
    isLive: over.isLive ?? true,
    stripeProductId: null,
  };
}

function store(over: Partial<Store> = {}): Store {
  return storeSchema.parse({
    name: "Test",
    theme: { colorPrimary: "#000", colorAccent: "#fff", fontFamily: "sans-serif", borderRadius: 2 },
    ...over,
  });
}

describe("getCollectionProducts", () => {
  it("returns empty for a slug that does not exist", () => {
    // v1 called .find(...).products and threw a TypeError here.
    expect(getCollectionProducts(store(), "nope")).toEqual([]);
  });

  it("skips ids whose product has been deleted", () => {
    // v1 mapped these to undefined and handed them to the renderer.
    const s = store({
      products: [product("a")],
      collections: [
        { id: "c1", slug: "c1", name: "C1", cover: null, productIds: ["a", "ghost"] },
      ],
    });

    expect(getCollectionProducts(s, "c1").map((p) => p.id)).toEqual(["a"]);
  });

  it("omits draft products from the storefront", () => {
    const s = store({
      products: [product("a"), product("b", { isLive: false })],
      collections: [{ id: "c1", slug: "c1", name: "C1", cover: null, productIds: ["a", "b"] }],
    });

    expect(getCollectionProducts(s, "c1").map((p) => p.id)).toEqual(["a"]);
  });

  it("preserves the collection's ordering, not the catalogue's", () => {
    const s = store({
      products: [product("a"), product("b"), product("c")],
      collections: [{ id: "c1", slug: "c1", name: "C1", cover: null, productIds: ["c", "a"] }],
    });

    expect(getCollectionProducts(s, "c1").map((p) => p.id)).toEqual(["c", "a"]);
  });
});

describe("getVisibleCollections", () => {
  it("hides the reserved featured collection from navigation", () => {
    const s = store({
      collections: [
        { id: "f", slug: "featured-products", name: "Featured", cover: null, productIds: [] },
        { id: "c1", slug: "hats", name: "Hats", cover: null, productIds: [] },
      ],
    });

    expect(getVisibleCollections(s).map((c) => c.slug)).toEqual(["hats"]);
  });
});

describe("isSoldOut", () => {
  it("is true only when every variant is out of stock", () => {
    const soldOut = product("a", {
      variants: [
        { id: "v1", label: "S", priceCents: 100, inventory: { type: "finite", quantity: 0 }, weightGrams: 0, stripePriceId: null },
        { id: "v2", label: "M", priceCents: 100, inventory: { type: "finite", quantity: 0 }, weightGrams: 0, stripePriceId: null },
      ],
    });
    const partial = product("b", {
      variants: [
        { id: "v1", label: "S", priceCents: 100, inventory: { type: "finite", quantity: 0 }, weightGrams: 0, stripePriceId: null },
        { id: "v2", label: "M", priceCents: 100, inventory: { type: "finite", quantity: 4 }, weightGrams: 0, stripePriceId: null },
      ],
    });

    expect(isSoldOut(soldOut)).toBe(true);
    expect(isSoldOut(partial)).toBe(false);
  });
});
