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

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  image: string | null;
  jsonLd: object | null;
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
export async function metaForPath(pathname: string): Promise<PageMeta> {
  const settings = await getSettings().catch(() => null);
  const storeName = settings?.name ?? "Beluga";
  const currency = settings?.currency ?? "USD";

  const fallback: PageMeta = {
    title: storeName,
    description: settings?.aboutText
      ? truncate(settings.aboutText)
      : `Shop ${storeName}.`,
    canonical: absolute(pathname),
    image: null,
    jsonLd: null,
  };

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
      if (!found) return fallback;

      return {
        ...fallback,
        title: `${found.name} · ${storeName}`,
        description: `${found.name} from ${storeName}.`,
        image: found.cover ? absolute(found.cover.path) : null,
      };
    }

    const product = /^\/product\/([^/]+)$/.exec(path);
    if (product) {
      const found = await findProductBySlug(decodeURIComponent(product[1]!));
      if (!found) return fallback;

      const image = found.images[0] ? absolute(found.images[0].path) : null;
      const description = found.seoDescription ?? truncate(found.description || `${found.name} from ${storeName}.`);

      return {
        title: found.seoTitle ?? `${found.name} · ${storeName}`,
        description,
        canonical: absolute(`/product/${found.slug}`),
        image,
        jsonLd: productJsonLd(found, description, image, currency),
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
