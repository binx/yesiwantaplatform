import { findCollectionBySlug, findProductBySlug, getSettings } from "../db/repository.js";
import type { Product } from "../shared/schema.js";
import { env } from "./env.js";

/**
 * Metadata for the HTML shell.
 *
 * The storefront is a client-rendered SPA, so a crawler or a link unfurler sees
 * only what is in `index.html` when it arrives. Rather than migrating to SSR,
 * the production HTML handler asks this what the `<head>` should say for the
 * path being requested, and injects it. The React app still boots normally; it
 * just arrives with the right tags already in the document.
 */

/** What goes into the `<head>`. All `injectMeta` needs, and all it is given. */
export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  image: string | null;
  jsonLd: object | null;
}

/**
 * A head, plus the status the shell carrying it should be sent with.
 *
 * 200 for everything that resolves; 404 for a product or collection slug that
 * does not — otherwise a crawler indexes the URL as a real page wearing the
 * store's generic title. The body is the same shell either way: React still
 * boots and renders its own not-found page, so this is a status correction and
 * not server-side rendering. It is the rule `/sitemap.xml` already follows,
 * which is what keeps the two from disagreeing about what exists.
 */
export interface ResolvedMeta extends PageMeta {
  status: 200 | 404;
}

/**
 * The readable text inside a fragment of rendered HTML.
 *
 * Only ever applied to the output of `server/markdown.ts`, which has already
 * been through the sanitiser — so this is a formatting step, not a security
 * one, and it must never be mistaken for the thing that makes HTML safe. The
 * entity decoding covers the handful the renderer emits; anything it misses
 * arrives as literal text in a meta description, which is ugly rather than
 * dangerous.
 */
function plainText(html: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    "#39": "'",
  };

  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_match, entity: string) => entities[entity] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Google truncates a description here, so there is no point sending more. */
const DESCRIPTION_LIMIT = 160;

function truncate(text: string, limit = DESCRIPTION_LIMIT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;

  // Cut at a word boundary rather than mid-word, then trim trailing punctuation.
  const cut = flat.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

function absolute(pathname: string): string {
  return new URL(pathname, env.PUBLIC_URL).toString();
}

/**
 * `formatMoney` returns a display string with a currency symbol. schema.org
 * wants a bare decimal, so the conversion is done here rather than reused.
 */
function decimalPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** The cheapest variant, which is the one a listing price should reflect. */
function leadVariant(product: Product) {
  return product.variants.reduce(
    (cheapest, variant) => (variant.priceCents < cheapest.priceCents ? variant : cheapest),
    product.variants[0]!,
  );
}

function productJsonLd(
  product: Product,
  description: string,
  image: string | null,
  currency: string,
): object {
  const variant = leadVariant(product);
  const inStock = variant.inventory.type !== "finite" || variant.inventory.quantity > 0;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description,
    ...(image ? { image } : {}),
    offers: {
      "@type": "Offer",
      sku: variant.id,
      price: decimalPrice(variant.priceCents),
      priceCurrency: currency,
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: absolute(`/product/${product.slug}`),
    },
  };
}

/**
 * Resolve the tags for one path.
 *
 * This runs on the HTML path for *every* request, bots probing nonsense URLs
 * included, so nothing in here may throw: a miss falls back to the store
 * defaults and the SPA still boots.
 */
export async function metaForPath(pathname: string): Promise<ResolvedMeta> {
  const settings = await getSettings().catch(() => null);
  const storeName = settings?.name ?? "Beluga";
  const currency = settings?.currency ?? "USD";

  const fallback: ResolvedMeta = {
    title: storeName,
    description: settings?.aboutText
      ? truncate(settings.aboutText)
      : `Shop ${storeName}.`,
    canonical: absolute(pathname),
    image: null,
    jsonLd: null,
    status: 200,
  };

  /** The same generic head, but told to the client and to crawlers as a miss. */
  const missing: ResolvedMeta = { ...fallback, status: 404 };

  try {
    const path = pathname.split("?")[0]!.replace(/\/+$/, "") || "/";

    if (path === "/") return fallback;

    if (path === "/shop") {
      return { ...fallback, title: `Shop · ${storeName}`, description: `Everything for sale at ${storeName}.` };
    }

    if (path === "/about") {
      return {
        ...fallback,
        title: `About · ${storeName}`,
        description: settings?.aboutText ? truncate(settings.aboutText) : `About ${storeName}.`,
      };
    }

    const collection = /^\/collection\/([^/]+)$/.exec(path);
    if (collection) {
      const found = await findCollectionBySlug(decodeURIComponent(collection[1]!));
      if (!found) return missing;

      /*
       * The collection's own words when it has any.
       *
       * This is the reason a description belongs on the collection rather than
       * in a Page: the link preview for /collection/home-goods gets better for
       * free. Tags are stripped rather than escaped — the value goes into a
       * `content="…"` attribute, where markup is noise, and rendered HTML is
       * the only form the server holds.
       */
      const introduction = plainText(found.descriptionHtml);

      return {
        ...fallback,
        title: `${found.name} · ${storeName}`,
        description: introduction ? truncate(introduction) : `${found.name} from ${storeName}.`,
        image: found.cover ? absolute(found.cover.path) : null,
      };
    }

    const product = /^\/product\/([^/]+)$/.exec(path);
    if (product) {
      // `liveOnly` passed explicitly, though it is the default: a draft must
      // be a miss here, not a page whose head is built from copy the merchant
      // has not published. The storefront refuses to render one anyway, so
      // answering 200 would leave the two disagreeing.
      const found = await findProductBySlug(decodeURIComponent(product[1]!), true);
      if (!found) return missing;

      const image = found.images[0] ? absolute(found.images[0].path) : null;
      const description = found.seoDescription ?? truncate(found.description || `${found.name} from ${storeName}.`);

      return {
        title: found.seoTitle ?? `${found.name} · ${storeName}`,
        description,
        canonical: absolute(`/product/${found.slug}`),
        image,
        jsonLd: productJsonLd(found, description, image, currency),
        status: 200,
      };
    }

    return fallback;
  } catch (error) {
    // A store with a broken database still has to serve a page a crawler can
    // read, so a resolver failure degrades to the defaults rather than a 500.
    console.warn(`Could not resolve metadata for ${pathname}:`, (error as Error).message);
    return fallback;
  }
}
