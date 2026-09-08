import { describe, expect, it } from "vitest";
import {
  getCollectionProducts,
  getVisibleCollections,
  isSoldOut,
  searchProducts,
  sortProducts,
} from "./catalog.js";
import { storeSchema, type Product, type Store } from "./schema.js";

function product(id: string, over: Partial<Product> = {}): Product {
  return productSchemaDefaults({ id, ...over });
}

function productSchemaDefaults(over: Partial<Product> & { id: string }): Product {
  return {
    id: over.id,
    slug: over.slug ?? over.id,
    name: over.name ?? over.id,
    description: over.description ?? "",
    bulletPoints: over.bulletPoints ?? [],
    seoTitle: null,
    seoDescription: null,
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

function priced(id: string, cents: number[], name = id): Product {
  return product(id, {
    name,
    variants: cents.map((priceCents, index) => ({
      id: `${id}-v${index}`,
      label: "",
      priceCents,
      inventory: { type: "infinite" as const },
      weightGrams: 0,
      stripePriceId: null,
    })),
  });
}

describe("searchProducts", () => {
  const catalogue = [
    product("tote", { name: "Blue Canvas Tote", description: "A roomy bag." }),
    product("mug", { name: "Enamel Mug", description: "Holds coffee.", bulletPoints: ["Blue rim"] }),
    product("cafe", { name: "Café Print", description: "A risograph." }),
  ];

  it("returns everything for an empty or whitespace query", () => {
    expect(searchProducts(catalogue, "")).toBe(catalogue);
    expect(searchProducts(catalogue, "   ")).toBe(catalogue);
  });

  it("matches on name, description and bullet points", () => {
    expect(searchProducts(catalogue, "roomy").map((p) => p.id)).toEqual(["tote"]);
    expect(searchProducts(catalogue, "rim").map((p) => p.id)).toEqual(["mug"]);
  });

  it("ignores case", () => {
    expect(searchProducts(catalogue, "TOTE").map((p) => p.id)).toEqual(["tote"]);
  });

  it("ignores diacritics in either direction", () => {
    // A shopper types what is on their keyboard, not what is on the label.
    expect(searchProducts(catalogue, "cafe").map((p) => p.id)).toEqual(["cafe"]);
    expect(searchProducts(catalogue, "café").map((p) => p.id)).toEqual(["cafe"]);
  });

  it("requires every term to match, not any of them", () => {
    // "blue" alone hits two products; together with "tote" only one.
    expect(searchProducts(catalogue, "blue").map((p) => p.id)).toEqual(["tote", "mug"]);
    expect(searchProducts(catalogue, "blue tote").map((p) => p.id)).toEqual(["tote"]);
  });

  it("returns nothing when there is no match", () => {
    expect(searchProducts(catalogue, "bicycle")).toEqual([]);
  });
});

describe("sortProducts", () => {
  const catalogue = [priced("c", [3000], "Cherry"), priced("a", [1000, 5000], "Apple"), priced("b", [1000], "Banana")];

  it("leaves the curated order alone for 'featured'", () => {
    expect(sortProducts(catalogue, "featured")).toBe(catalogue);
  });

  it("sorts by the lowest variant price", () => {
    // Apple's cheapest variant is 1000, not its 5000 one.
    expect(sortProducts(catalogue, "price-asc").map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(sortProducts(catalogue, "price-desc").map((p) => p.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps the curated order among equal prices", () => {
    // a and b both start at 1000; a came first and must stay first.
    expect(sortProducts(catalogue, "price-asc").slice(0, 2).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("sorts by name", () => {
    expect(sortProducts(catalogue, "name").map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const before = catalogue.map((p) => p.id);
    sortProducts(catalogue, "name");
    expect(catalogue.map((p) => p.id)).toEqual(before);
  });
});
