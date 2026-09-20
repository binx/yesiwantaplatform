import { z } from "zod";

/**
 * The platform contract.
 *
 * Both the client and the API validate against these schemas, so the data
 * source can change underneath without touching components. What the
 * platform sells is a subscription to an artist, so this file holds the
 * platform's own identity, its look, its pages and the two numbers every
 * payout is computed from: what a printed card costs, and what the platform
 * keeps. The artists themselves are in `shared/platform.ts`.
 */

/** Integer minor units. See shared/money.ts — never a float. */
export const centsSchema = z.number().int().min(0);

export const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase, hyphen-separated slug");

export const imageSchema = z.object({
  /** Path relative to the asset root. Always the full-size file. */
  path: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Required so imagery is never invisible to screen readers. */
  alt: z.string(),
  /**
   * Widths of the resized copies that exist alongside `path`, for `srcset`.
   * Empty means "serve the single full-size file".
   */
  widths: z.array(z.number().int().positive()).default([]),
});

/**
 * Slugs the router already owns.
 *
 * A page is served from `/:slug`, registered last so it cannot shadow a static
 * route — but a page at `/artists` would simply never render, with nothing to
 * say why. They are refused when the page is saved instead. The same list
 * guards an artist's own slug, which lives under `/a/` but shares the
 * vocabulary people reach for.
 */
export const RESERVED_PAGE_SLUGS: Readonly<Record<string, string>> = {
  a: "artist pages",
  artists: "the artist directory",
  gallery: "the gallery",
  subscribe: "the subscription flow",
  studio: "the artist studio",
  admin: "the admin",
  setup: "the setup wizard",
  account: "customer accounts",
  assets: "uploaded images",
  api: "the API",
  new: "creating things",
  login: "signing in",
  register: "signing up",
};

/** Enough to render a nav link. Bodies are fetched a page at a time. */
export const pageSummarySchema = z.object({
  id: z.string().min(1),
  slug: slugSchema,
  title: z.string().min(1),
  /** Linked from the site banner. */
  inNav: z.boolean().default(false),
  position: z.number().int().min(0).default(0),
});

/** A page as a visitor receives it: sanitised HTML, never Markdown. */
export const pageSchema = pageSummarySchema.extend({
  bodyHtml: z.string().default(""),
});

/** A page as its editor receives it: Markdown source, drafts included. */
export const pageDraftSchema = pageSummarySchema.extend({
  body: z.string().default(""),
  isLive: z.boolean().default(false),
});

export const colorSchemeSchema = z.enum(["light", "dark"]);

/**
 * Where a theme may load a font stylesheet from.
 *
 * The value widens the site's Content-Security-Policy by exactly one origin,
 * so the set of things it may be is small: an absolute `https://` URL, or a
 * same-origin path under `/assets/` for a self-hosted face.
 */
export const fontUrlSchema = z
  .string()
  .max(2000)
  .refine(
    (value) => value.startsWith("https://") || value.startsWith("/assets/"),
    "Use an https:// address or a path under /assets/.",
  )
  .refine((value) => !value.startsWith("//"), "Use an https:// address or a path under /assets/.");

/** The platform's language and formatting conventions, as a BCP 47 tag. */
export const localeSchema = z
  .string()
  .min(2)
  .max(35)
  .refine((value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  }, "Use a language tag like en-US, de-DE or fr-CA.");

export const themeSchema = z.object({
  colorPrimary: z.string(),
  colorAccent: z.string(),
  fontFamily: z.string(),
  /** Where the browser fetches the faces named in `fontFamily`. Null means a system font. */
  fontUrl: fontUrlSchema.nullable().default(null),
  /** Corner radius in px. Capped at 4. */
  borderRadius: z.number().int().min(0).max(4),
  colorScheme: colorSchemeSchema.default("light"),
  /** Page background. Null means "whatever the scheme says". */
  colorPage: z.string().nullable().default(null),
  /** Replaces the wordmark in the banner when set. */
  logo: imageSchema.nullable().default(null),
});

/**
 * Where a hero button may point: a same-origin path or an absolute `https://`
 * URL, and nothing else, because the value ends up in an `href`.
 */
export const heroHrefSchema = z
  .string()
  .max(2000)
  .refine(
    (value) => value.startsWith("/") || value.startsWith("https://"),
    "Use a path starting with / or a full https:// address.",
  )
  .refine((value) => !value.startsWith("//"), "Use a path starting with / or a full https:// address.");

/** The landing page's opening block. Every field nullable; every reader falls back. */
export const heroSchema = z.object({
  /** Null renders the built-in "yes, i want a postcard". */
  heading: z.string().max(120).nullable().default(null),
  /** Null renders the built-in line about moving beyond social media. */
  text: z.string().max(500).nullable().default(null),
  /** Null renders "Find an artist". */
  buttonLabel: z.string().max(60).nullable().default(null),
  /** Null points at /artists. */
  buttonHref: heroHrefSchema.nullable().default(null),
  /** Beside the hero. Null keeps the built-in illustration. */
  image: imageSchema.nullable().default(null),
});

export const defaultHero: z.infer<typeof heroSchema> = {
  heading: null,
  text: null,
  buttonLabel: null,
  buttonHref: null,
  image: null,
};

/**
 * The money rules, as every visitor may know them.
 *
 * `printCostCents` and `platformFeeCents` are what come off a subscriber's
 * monthly payment before the rest is sent to the artist — read by the payout
 * ledger the moment a card is accepted by the printer, never recomputed
 * later. `minMonthlyPriceCents` is the floor an artist may charge: below it a
 * card would cost the platform money to send.
 */
export const pricingSchema = z.object({
  printCostCents: centsSchema,
  platformFeeCents: centsSchema,
  minMonthlyPriceCents: centsSchema,
});

export const storeSchema = z.object({
  name: z.string().min(1),
  /** Publishable key only. The secret key must never reach the client. */
  stripePublishableKey: z.string().nullable().default(null),
  currency: z.string().length(3).default("USD"),
  locale: localeSchema.default("en-US"),
  pricing: pricingSchema,
  theme: themeSchema,
  hero: heroSchema.default(defaultHero),
  /** Live pages, as summaries only; bodies come from `/api/pages/:slug`. */
  pages: z.array(pageSummarySchema).default([]),
});

/**
 * The default look: warm paper, near-black ink, and Quicksand — the face
 * yesiwantapostcard.com set its whole page in.
 */
export const defaultTheme: Theme = {
  colorPrimary: "#1c1917",
  colorAccent: "#f5c542",
  fontFamily: 'Quicksand, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  borderRadius: 4,
  colorScheme: "light",
  colorPage: "#efece6",
  logo: null,
  fontUrl:
    "https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600;700&family=Sacramento&family=Patrick+Hand&display=swap",
};

/** What a fresh platform charges and keeps, in cents. Settings is where they change. */
export const defaultPricing: Pricing = {
  printCostCents: 120,
  platformFeeCents: 60,
  minMonthlyPriceCents: 300,
};

export type Cents = z.infer<typeof centsSchema>;
export type Image = z.infer<typeof imageSchema>;
export type PageSummary = z.infer<typeof pageSummarySchema>;
export type Page = z.infer<typeof pageSchema>;
export type PageDraft = z.infer<typeof pageDraftSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type ColorScheme = z.infer<typeof colorSchemeSchema>;
export type Locale = z.infer<typeof localeSchema>;
export type Pricing = z.infer<typeof pricingSchema>;
export type Store = z.infer<typeof storeSchema>;
export type Hero = z.infer<typeof heroSchema>;

/**
 * What one sent postcard earns its artist: the subscriber's monthly price
 * less the print cost and the platform's fee, and never below zero. Pure, so
 * the ledger, the studio's earnings page and the admin's settings preview all
 * do the same arithmetic.
 */
export function artistShareCents(monthlyPriceCents: number, pricing: Pick<Pricing, "printCostCents" | "platformFeeCents">): number {
  return Math.max(0, monthlyPriceCents - pricing.printCostCents - pricing.platformFeeCents);
}
