import { z } from "zod";

/**
 * The store contract.
 *
 * Both the client and the API validate against these schemas, so the data
 * source can change underneath without touching components. The catalogue is
 * gone — there is one thing for sale and its price is a setting — so this is
 * the store's identity, its look, its pages and the price of a postcard.
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
  /** Required so imagery is never invisible to screen readers. */
  alt: z.string(),
  /**
   * Widths of the resized copies that exist alongside `path`, for `srcset`.
   * Empty means "serve the single full-size file".
   */
  widths: z.array(z.number().int().positive()).default([]),
});

/**
 * Slugs the storefront router already owns.
 *
 * A page is served from `/:slug`, registered last so it cannot shadow a static
 * route — but a page at `/cart` would simply never render, with nothing to say
 * why. They are refused when the page is saved instead.
 */
export const RESERVED_PAGE_SLUGS: Readonly<Record<string, string>> = {
  create: "the postcard designer",
  cart: "the cart",
  confirm: "the order confirmation page",
  about: "the About page",
  admin: "the admin",
  setup: "the setup wizard",
  account: "customer accounts",
  unsubscribe: "the unsubscribe page",
  assets: "uploaded images",
  api: "the API",
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

/** A page as a shopper receives it: sanitised HTML, never Markdown. */
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
 * The value widens the store's Content-Security-Policy by exactly one origin,
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

/** The store's language and formatting conventions, as a BCP 47 tag. */
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
  /** Replaces the store-name wordmark in the banner when set. */
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
  /** Null renders the store name. */
  heading: z.string().max(120).nullable().default(null),
  /** Null renders the built-in line about scheduling postcards. */
  text: z.string().max(500).nullable().default(null),
  /** Null renders "Make a postcard". */
  buttonLabel: z.string().max(60).nullable().default(null),
  /** Null points at /create. */
  buttonHref: heroHrefSchema.nullable().default(null),
  /** Beside the hero. Null keeps the built-in photo. */
  image: imageSchema.nullable().default(null),
});

export const defaultHero: z.infer<typeof heroSchema> = {
  heading: null,
  text: null,
  buttonLabel: null,
  buttonHref: null,
  image: null,
};

export const storeSchema = z.object({
  name: z.string().min(1),
  /** Publishable key only. The secret key must never reach the client. */
  stripePublishableKey: z.string().nullable().default(null),
  currency: z.string().length(3).default("USD"),
  locale: localeSchema.default("en-US"),
  /** What one postcard costs. The storefront shows it; the server charges it. */
  postcardPriceCents: centsSchema,
  /** What one postcard mailed abroad costs. Null: the shop mails within the US only. */
  internationalPostcardPriceCents: centsSchema.nullable().default(null),
  theme: themeSchema,
  hero: heroSchema.default(defaultHero),
  /** Live pages, as summaries only; bodies come from `/api/pages/:slug`. */
  pages: z.array(pageSummarySchema).default([]),
});

/**
 * The default look: near-black ink, the site's yellow as the accent, and
 * Quicksand — which v1 loaded from Google Fonts along with the two script
 * faces the postcard back can be set in.
 */
export const defaultTheme: Theme = {
  colorPrimary: "#333333",
  colorAccent: "#ffff37",
  fontFamily: 'Quicksand, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  borderRadius: 2,
  colorScheme: "light",
  colorPage: null,
  logo: null,
  fontUrl:
    "https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600;700&family=Sacramento&family=Patrick+Hand&display=swap",
};

export type Cents = z.infer<typeof centsSchema>;
export type Image = z.infer<typeof imageSchema>;
export type PageSummary = z.infer<typeof pageSummarySchema>;
export type Page = z.infer<typeof pageSchema>;
export type PageDraft = z.infer<typeof pageDraftSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type ColorScheme = z.infer<typeof colorSchemeSchema>;
export type Locale = z.infer<typeof localeSchema>;
export type Store = z.infer<typeof storeSchema>;
export type Hero = z.infer<typeof heroSchema>;
