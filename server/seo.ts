import { getSettings } from "../db/repository.js";
import { findPageBySlug } from "../db/pages-repository.js";
import { findArtistBySlug } from "../db/artists-repository.js";
import { languageOf } from "../shared/locale.js";
import { formatMoney } from "../shared/money.js";
import { SITE_TITLE } from "../shared/site.js";
import { env } from "./env.js";

/**
 * Metadata for the HTML shell.
 *
 * The site is a client-rendered SPA, so a crawler or a link unfurler sees
 * only what is in `index.html` when it arrives. The production HTML handler
 * asks this what the `<head>` should say for the path being requested, and
 * injects it. The React app still boots normally.
 *
 * The title is the same on every path (`SITE_TITLE`); what varies per page
 * is the description, the canonical, the image and the structured data.
 */

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  image: string | null;
  jsonLd: object | null;
  /** The theme's font stylesheet, or null for a system font. */
  fontUrl: string | null;
  /** `<html lang>`, from the platform's locale. */
  lang: string;
}

export interface ResolvedMeta extends PageMeta {
  status: 200 | 404;
}

/** Google truncates a description here, so there is no point sending more. */
const DESCRIPTION_LIMIT = 160;

function truncate(text: string, limit = DESCRIPTION_LIMIT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;

  const cut = flat.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

/** Markdown to something that fits in a `content="…"` attribute. */
function plainText(markdown: string): string {
  return markdown
    .replace(/[#*_>`]/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function absolute(pathname: string): string {
  return new URL(pathname, env.PUBLIC_URL).toString();
}

const DEFAULT_DESCRIPTION = "Subscribe to an artist and get one of their postcards in the mail every month. Let's move beyond social media.";

/** Client routes with nothing to say about themselves beyond the platform's own line. */
const PLAIN_ROUTES = ["/account", "/studio", "/subscribe", "/admin", "/setup"];

/**
 * Resolve the tags for one path.
 *
 * This runs on the HTML path for every request, bots probing nonsense URLs
 * included, so nothing in here may throw: a miss falls back to the platform
 * defaults and the SPA still boots.
 */
export async function metaForPath(pathname: string): Promise<ResolvedMeta> {
  const settings = await getSettings().catch(() => null);
  const storeName = settings?.name ?? "Yes I Want A Postcard";
  const fontUrl = settings?.theme.fontUrl ?? null;
  const lang = languageOf(settings?.locale ?? "en-US");
  const currency = settings?.currency ?? "USD";
  const locale = settings?.locale ?? "en-US";

  const fallback: ResolvedMeta = {
    title: SITE_TITLE,
    description: truncate(settings?.hero.text ?? DEFAULT_DESCRIPTION),
    canonical: absolute(pathname),
    image: settings?.hero.image ? absolute(`/assets/${settings.hero.image.path}`) : absolute("/favicon.png"),
    jsonLd: null,
    fontUrl,
    lang,
    status: 200,
  };

  try {
    const path = pathname.split("?")[0]!.replace(/\/+$/, "") || "/";

    if (path === "/") return fallback;

    if (path === "/artists") {
      return { ...fallback, description: truncate("Every artist you can subscribe to, and what a month of their mail costs.") };
    }

    if (path === "/gallery") {
      return { ...fallback, description: truncate("Postcards recently mailed to subscribers, by the artists who made them.") };
    }

    if (path === "/for-artists") {
      return { ...fallback, title: `For artists · ${storeName}`, description: truncate("Mail one postcard a month to the people who want to hear from you. Set your price; we print, post and pay you.") };
    }

    if (PLAIN_ROUTES.some((p) => path === p || path.startsWith(`${p}/`))) return fallback;

    const artistMatch = /^\/a\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path);
    if (artistMatch) {
      const artist = await findArtistBySlug(artistMatch[1]!);
      if (!artist || artist.status === "draft") return { ...fallback, status: 404 };
      const price = formatMoney(artist.monthlyPriceCents, currency, locale);
      const bio = plainText(artist.bio);
      return {
        ...fallback,
        description: truncate(artist.tagline ?? (bio || `A postcard from ${artist.name} every month, for ${price}.`)),
        canonical: absolute(path),
        image: artist.avatar ? absolute(`/assets/${artist.avatar.path}`) : fallback.image,
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "Person",
          name: artist.name,
          url: absolute(path),
          ...(artist.tagline ? { description: artist.tagline } : {}),
        },
      };
    }

    if (path.startsWith("/a/")) return { ...fallback, status: 404 };

    const slug = decodeURIComponent(path.slice(1));
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      const page = await findPageBySlug(slug, true);
      if (!page) return { ...fallback, status: 404 };

      const body = plainText(page.body);
      return {
        ...fallback,
        description: body ? truncate(body) : `${page.title} — ${storeName}.`,
        canonical: absolute(`/${slug}`),
      };
    }

    return { ...fallback, status: 404 };
  } catch (error) {
    console.warn(`Could not resolve metadata for ${pathname}:`, (error as Error).message);
    return fallback;
  }
}
