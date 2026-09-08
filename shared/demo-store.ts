import type { Store } from "./schema.js";

/**
 * The store a fresh clone renders before the owner has configured anything.
 *
 * Phase 2 replaces this with rows from the database; it conforms to the same
 * schema, so nothing downstream changes. Prices are integer cents throughout.
 */
export const demoStore: Store = {
  name: "Beluga Demo",
  // No zones in the fixture, so the cart offers no destination list.
  shipping: { countries: [], worldwide: false },
  stripePublishableKey: null,
  currency: "USD",
  aboutText:
    "This is the demo store that ships with Beluga.\n\nEverything you see here is placeholder data. Run the setup wizard to connect Stripe, then replace these products with your own.",
  theme: {
    colorPrimary: "#18181b",
    colorAccent: "#e07a5f",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
    borderRadius: 2,
    colorScheme: "light",
    colorPage: null,
    logo: null,
  },
  // Prices are quoted without tax, which is the default a US-shaped demo
  // wants; a store that quotes VAT-inclusive prices changes it in Settings.
  taxBehavior: "exclusive",
  // Empty: the fixture is a store before anyone has written a page. An install
  // whose `aboutText` predates the pages table gets an About page from
  // `adoptAboutTextAsPage` on the next migration, not from here.
  pages: [],
  products: [
    {
      id: "demo-tote",
      slug: "canvas-tote",
      name: "Canvas Tote",
      kind: "physical",
      description:
        "Heavyweight cotton canvas with a boxed base and webbing straps. Roomy enough for a laptop, a lunch, and a paperback.",
      bulletPoints: ["16 oz cotton canvas", "38 × 40 × 12 cm", "Machine washable, cold"],
      seoTitle: null,
      seoDescription: null,
      images: [
        { path: "demo/tote-front.svg", width: 900, height: 1200, alt: "Canvas tote, front view", widths: [] },
        { path: "demo/tote-side.svg", width: 900, height: 1200, alt: "Canvas tote, side view", widths: [] },
        {
          path: "demo/tote-detail.svg",
          width: 1200,
          height: 900,
          alt: "Close-up of the tote's webbing strap",
          widths: [],
        },
      ],
      variantName: "size",
      variants: [
        {
          id: "demo-tote-s",
          label: "Small",
          priceCents: 3400,
          inventory: { type: "finite", quantity: 12 },
          weightGrams: 250,
          stripePriceId: null,
          optionValues: ["Small"],
        },
        {
          id: "demo-tote-l",
          label: "Large",
          priceCents: 4200,
          // Deliberately low so the "only 2 left" affordance is visible.
          inventory: { type: "finite", quantity: 2 },
          weightGrams: 250,
          stripePriceId: null,
          optionValues: ["Large"],
        },
      ],
      options: [{ id: "demo-tote-opt-size", name: "size", values: ["Small", "Large"] }],
      optionGroups: [{ name: "gift wrap", choices: ["No", "Yes"] }],
      taxCode: null,
      isLive: true,
      stripeProductId: null,
      stripeTaxSignature: null,
    },
    {
      id: "demo-mug",
      slug: "enamel-mug",
      name: "Enamel Mug",
      kind: "physical",
      description:
        "Speckled enamel over steel, with a rolled rim. Takes a campfire or a dishwasher without complaint.",
      bulletPoints: ["350 ml", "Enamel over steel", "Not microwave safe"],
      seoTitle: null,
      seoDescription: null,
      images: [
        { path: "demo/mug.svg", width: 1000, height: 1000, alt: "Speckled enamel mug", widths: [] },
        { path: "demo/mug-alt.svg", width: 1000, height: 1000, alt: "Enamel mug filled with coffee", widths: [] },
      ],
      variantName: null,
      variants: [
        {
          id: "demo-mug-default",
          label: "",
          priceCents: 1800,
          inventory: { type: "infinite" },
          weightGrams: 400,
          stripePriceId: null,
          optionValues: [],
        },
      ],
      options: [],
      optionGroups: [],
      taxCode: null,
      isLive: true,
      stripeProductId: null,
      stripeTaxSignature: null,
    },
    {
      id: "demo-print",
      slug: "risograph-print",
      name: "Risograph Print",
      kind: "physical",
      description:
        "Two-colour risograph on 120 gsm recycled stock. Every pull sits a little differently, which is the point.",
      bulletPoints: ["A3, unframed", "Edition of 50", "Signed on the reverse"],
      seoTitle: null,
      seoDescription: null,
      images: [
        { path: "demo/print.svg", width: 900, height: 1200, alt: "Two-colour risograph print", widths: [] },
      ],
      variantName: null,
      variants: [
        {
          id: "demo-print-default",
          label: "",
          priceCents: 6500,
          // Sold out, so the disabled add-to-cart path is exercised.
          inventory: { type: "finite", quantity: 0 },
          weightGrams: 60,
          stripePriceId: null,
          optionValues: [],
        },
      ],
      options: [],
      optionGroups: [],
      taxCode: null,
      isLive: true,
      stripeProductId: null,
      stripeTaxSignature: null,
    },
    {
      id: "demo-scarf",
      slug: "silk-scarf",
      name: "Silk Scarf",
      kind: "physical",
      description: "Hand-rolled edges on lightweight silk twill. Folds down to nothing in a pocket.",
      bulletPoints: ["90 × 90 cm", "100% silk twill", "Dry clean only"],
      seoTitle: null,
      seoDescription: null,
      images: [{ path: "demo/scarf.svg", width: 1200, height: 900, alt: "Folded silk scarf", widths: [] }],
      variantName: "colour",
      variants: [
        {
          id: "demo-scarf-rust",
          label: "Rust",
          priceCents: 8800,
          inventory: { type: "infinite" },
          weightGrams: 80,
          stripePriceId: null,
          optionValues: ["Rust"],
        },
        {
          id: "demo-scarf-slate",
          label: "Slate",
          priceCents: 8800,
          inventory: { type: "finite", quantity: 5 },
          weightGrams: 80,
          stripePriceId: null,
          optionValues: ["Slate"],
        },
      ],
      options: [{ id: "demo-scarf-opt-colour", name: "colour", values: ["Rust", "Slate"] }],
      optionGroups: [],
      taxCode: null,
      isLive: true,
      stripeProductId: null,
      stripeTaxSignature: null,
    },
    {
      id: "demo-hoodie",
      slug: "zip-hoodie",
      name: "Zip Hoodie",
      kind: "physical",
      description:
        "Brushed-fleece interior with a full metal zip. Cut generously, so it layers over anything.",
      bulletPoints: ["Cotton-poly fleece", "Ribbed cuffs and hem", "Two axes: size and colour"],
      seoTitle: null,
      seoDescription: null,
      images: [
        { path: "demo/hoodie.svg", width: 1000, height: 1200, alt: "Zip hoodie, folded flat", widths: [] },
      ],
      // The first axis's name for one release, deprecated in favour of `options`.
      variantName: "size",
      variants: [
        {
          id: "demo-hoodie-s-black",
          label: "Small / Black",
          priceCents: 5800,
          inventory: { type: "finite", quantity: 6 },
          weightGrams: 420,
          stripePriceId: null,
          optionValues: ["Small", "Black"],
        },
        {
          id: "demo-hoodie-s-navy",
          label: "Small / Navy",
          priceCents: 5800,
          // Sold out, so the storefront's per-combination disabling is exercised.
          inventory: { type: "finite", quantity: 0 },
          weightGrams: 420,
          stripePriceId: null,
          optionValues: ["Small", "Navy"],
        },
        {
          id: "demo-hoodie-l-black",
          label: "Large / Black",
          priceCents: 6200,
          inventory: { type: "finite", quantity: 4 },
          weightGrams: 460,
          stripePriceId: null,
          optionValues: ["Large", "Black"],
        },
        {
          id: "demo-hoodie-l-navy",
          label: "Large / Navy",
          priceCents: 6200,
          inventory: { type: "infinite" },
          weightGrams: 460,
          stripePriceId: null,
          optionValues: ["Large", "Navy"],
        },
      ],
      options: [
        { id: "demo-hoodie-opt-size", name: "size", values: ["Small", "Large"] },
        { id: "demo-hoodie-opt-colour", name: "colour", values: ["Black", "Navy"] },
      ],
      optionGroups: [],
      taxCode: null,
      isLive: true,
      stripeProductId: null,
      stripeTaxSignature: null,
    },
  ],
  collections: [
    {
      id: "demo-featured",
      slug: "featured-products",
      name: "Featured",
      cover: null,
      productIds: ["demo-tote", "demo-print", "demo-mug"],
    },
    {
      id: "demo-home",
      slug: "home-goods",
      name: "Home Goods",
      cover: { path: "demo/cover-home.svg", width: 1600, height: 900, alt: "Home goods", widths: [] },
      productIds: ["demo-mug", "demo-tote"],
    },
    {
      id: "demo-paper",
      slug: "paper-goods",
      name: "Paper Goods",
      cover: { path: "demo/cover-paper.svg", width: 1600, height: 900, alt: "Paper goods", widths: [] },
      productIds: ["demo-print", "demo-scarf"],
    },
  ],
};
