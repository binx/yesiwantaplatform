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
  },
  products: [
    {
      id: "demo-tote",
      slug: "canvas-tote",
      name: "Canvas Tote",
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
        },
        {
          id: "demo-tote-l",
          label: "Large",
          priceCents: 4200,
          // Deliberately low so the "only 2 left" affordance is visible.
          inventory: { type: "finite", quantity: 2 },
          weightGrams: 250,
          stripePriceId: null,
        },
      ],
      optionGroups: [{ name: "gift wrap", choices: ["No", "Yes"] }],
      isLive: true,
      stripeProductId: null,
    },
    {
      id: "demo-mug",
      slug: "enamel-mug",
      name: "Enamel Mug",
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
        },
      ],
      optionGroups: [],
      isLive: true,
      stripeProductId: null,
    },
    {
      id: "demo-print",
      slug: "risograph-print",
      name: "Risograph Print",
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
        },
      ],
      optionGroups: [],
      isLive: true,
      stripeProductId: null,
    },
    {
      id: "demo-scarf",
      slug: "silk-scarf",
      name: "Silk Scarf",
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
        },
        {
          id: "demo-scarf-slate",
          label: "Slate",
          priceCents: 8800,
          inventory: { type: "finite", quantity: 5 },
          weightGrams: 80,
          stripePriceId: null,
        },
      ],
      optionGroups: [],
      isLive: true,
      stripeProductId: null,
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
