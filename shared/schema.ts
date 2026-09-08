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
  /**
   * Shown in the variant picker, e.g. "Medium". Empty for single-variant
   * products. For a multi-axis product this is generated from `optionValues`
   * — "Large / Blue" — and regenerated on every save.
   */
  label: z.string(),
  priceCents: centsSchema,
  inventory: inventorySchema,
  /**
   * Shipping weight in grams. Zero means the store has not recorded one, which
   * is not an error — a flat-rate store never needs it, and weight-banded rates
   * simply see a zero-gram parcel.
   */
  weightGrams: z.number().int().min(0).default(0),
  /** Set once the variant has been pushed to Stripe. */
  stripePriceId: z.string().nullable().default(null),
  /**
   * The value this variant holds on each of the product's axes, in the same
   * order as `product.options`. Empty for a product with no options.
   */
  optionValues: z.array(z.string()).default([]),
});

/**
 * A priced variant axis: "Size", with values like "Small" and "Large".
 *
 * Distinct from `optionGroupSchema` — that is a non-priced choice like gift
 * wrap, deliberately kept separate. This is the priced kind: every variant
 * names exactly one value on every axis here, in order.
 */
export const productOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  values: z.array(z.string().min(1)).min(1),
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

/**
 * Whether a quoted price already contains tax.
 *
 * The choice is regional rather than aesthetic: EU stores quote inclusive
 * prices and US stores exclusive ones, and getting it wrong changes what the
 * buyer pays. Stripe calls the unset state "unspecified"; Beluga always states
 * one, so a price is never ambiguous.
 */
export const taxBehaviorSchema = z.enum(["exclusive", "inclusive"]);

/** Stripe's "general — tangible goods", used when nothing more specific is set. */
export const DEFAULT_TAX_CODE = "txcd_99999999";

/** Stripe tax codes are `txcd_` and digits, e.g. txcd_99999999. */
export const taxCodeSchema = z
  .string()
  .regex(/^txcd_[0-9]+$/, "must be a Stripe tax code, like txcd_99999999");

export const productSchema = z.object({
  id: z.string().min(1),
  slug: slugSchema,
  name: z.string().min(1),
  description: z.string().default(""),
  bulletPoints: z.array(z.string()).default([]),
  /**
   * Search-result overrides. Null means the tag is generated from the name and
   * description. The limits are where Google truncates.
   */
  seoTitle: z.string().max(70).nullable().default(null),
  seoDescription: z.string().max(160).nullable().default(null),
  images: z.array(imageSchema).default([]),
  /**
   * @deprecated Superseded by `options`. Kept for one release so a rollback
   * still has a label — see db/schema.sqlite.ts.
   */
  variantName: z.string().nullable().default(null),
  variants: z.array(variantSchema).min(1),
  /** Priced axes — up to three, e.g. Size × Colour. Empty for a simple product. */
  options: z.array(productOptionSchema).max(3).default([]),
  optionGroups: z.array(optionGroupSchema).default([]),
  /** Stripe tax code. Null uses the store default. */
  taxCode: taxCodeSchema.nullable().default(null),
  /** Draft products are editable but absent from the storefront. */
  isLive: z.boolean().default(false),
  stripeProductId: z.string().nullable().default(null),
  /**
   * The tax settings this product was last published to Stripe under, as
   * `code|behavior`. Null means it has never been published, or was published
   * before tax existed. Compared against the store's current settings to tell
   * the merchant which products need republishing.
   */
  stripeTaxSignature: z.string().nullable().default(null),
});

export const collectionSchema = z.object({
  id: z.string().min(1),
  slug: slugSchema,
  name: z.string().min(1),
  cover: imageSchema.nullable().default(null),
  /** Product ids, in display order. */
  productIds: z.array(z.string()).default([]),
});

/**
 * Slugs the storefront router already owns.
 *
 * A page is served from `/:slug`, registered last so it cannot shadow a static
 * route — but "cannot shadow" and "is reachable" are different things: a page
 * at `/cart` would simply never render, with nothing to say why. They are
 * refused when the page is saved instead, and the value here is what the
 * refusal names.
 */
export const RESERVED_PAGE_SLUGS: Readonly<Record<string, string>> = {
  shop: "the shop",
  cart: "the cart",
  confirm: "the order confirmation page",
  product: "product pages",
  collection: "collection pages",
  about: "the About page",
  admin: "the admin",
  setup: "the setup wizard",
  account: "customer accounts",
};

/** Enough to render a nav link. Bodies are fetched a page at a time. */
export const pageSummarySchema = z.object({
  id: z.string().min(1),
  slug: slugSchema,
  title: z.string().min(1),
  /** Linked from the storefront banner. */
  inNav: z.boolean().default(false),
  position: z.number().int().min(0).default(0),
});

/**
 * A page as a shopper receives it.
 *
 * `bodyHtml` is rendered from stored Markdown and sanitised on the server, so
 * the storefront neither ships a Markdown parser nor has to trust what it is
 * handed. The Markdown source is not sent; only the editor needs it.
 */
export const pageSchema = pageSummarySchema.extend({
  bodyHtml: z.string().default(""),
});

/** A page as its editor receives it: Markdown source, drafts included. */
export const pageDraftSchema = pageSummarySchema.extend({
  body: z.string().default(""),
  isLive: z.boolean().default(false),
});

export const colorSchemeSchema = z.enum(["light", "dark"]);

export const themeSchema = z.object({
  colorPrimary: z.string(),
  colorAccent: z.string(),
  fontFamily: z.string(),
  /**
   * Corner radius in px. Capped at 4: past that the storefront stops reading as
   * a shop and starts reading as a dashboard, and the range 4–24 was almost
   * entirely occupied by looks no shop wanted.
   */
  borderRadius: z.number().int().min(0).max(4),
  /**
   * Which base palette the storefront is built on. The shop picks one and every
   * shopper gets it — there is no per-viewer toggle, so a shop's look is the
   * same in every screenshot anyone takes of it.
   */
  colorScheme: colorSchemeSchema.default("light"),
  /**
   * Page background. Null means "whatever the scheme says", which is the useful
   * default: a shop switching to dark should not have to also remember to
   * change its background out of near-white.
   */
  colorPage: z.string().nullable().default(null),
  /** Replaces the store-name wordmark in the banner when set. */
  logo: imageSchema.nullable().default(null),
});

export const storeSchema = z.object({
  name: z.string().min(1),
  /** Publishable key only. The secret key must never reach the client. */
  stripePublishableKey: z.string().nullable().default(null),
  currency: z.string().length(3).default("USD"),
  theme: themeSchema,
  aboutText: z.string().nullable().default(null),
  /**
   * How prices are quoted, so the storefront can say "includes $X tax" rather
   * than adding a row. Not whether tax is *on* — that is the server's business
   * and the shopper only ever sees the result.
   */
  taxBehavior: taxBehaviorSchema.default("exclusive"),
  collections: z.array(collectionSchema).default([]),
  /**
   * Live pages, as summaries only — the banner needs their titles on first
   * paint, and a store with ten long policies should not put all of that in
   * every shopper's initial payload. Bodies come from `/api/pages/:slug`.
   */
  pages: z.array(pageSummarySchema).default([]),
  products: z.array(productSchema).default([]),
  /**
   * Where the shop ships, so the cart can ask for a destination.
   *
   * Hosted Stripe Checkout collects the address *after* the session exists, so
   * a zone-priced store has to know the country before then — see
   * docs/shipping.md. The cart asks; this is the list it offers.
   */
  shipping: z
    .object({
      countries: z.array(z.string().length(2)).default([]),
      /** A catch-all zone exists, so unlisted countries are still priced. */
      worldwide: z.boolean().default(false),
    })
    .default({ countries: [], worldwide: false }),
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
  colorScheme: "light",
  colorPage: null,
  logo: null,
};

/** Featured products are a normal collection at this reserved slug. */
export const FEATURED_SLUG = "featured-products";

export type Cents = z.infer<typeof centsSchema>;
export type Image = z.infer<typeof imageSchema>;
export type Inventory = z.infer<typeof inventorySchema>;
export type Variant = z.infer<typeof variantSchema>;
export type OptionGroup = z.infer<typeof optionGroupSchema>;
export type ProductOption = z.infer<typeof productOptionSchema>;
export type Product = z.infer<typeof productSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type PageSummary = z.infer<typeof pageSummarySchema>;
export type Page = z.infer<typeof pageSchema>;
export type PageDraft = z.infer<typeof pageDraftSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type ColorScheme = z.infer<typeof colorSchemeSchema>;
export type TaxBehavior = z.infer<typeof taxBehaviorSchema>;
export type Store = z.infer<typeof storeSchema>;
