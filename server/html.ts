import { FONT_LINK_ID } from "../shared/locale.js";
import { CARD_FONTS_LINK_ID, CARD_FONTS_ORIGINS, CARD_FONTS_URL } from "../shared/postcards.js";
import type { PageMeta } from "./seo.js";

/**
 * Metadata injection into the built SPA shell.
 *
 * Kept apart from `app.ts` so it can be tested against a fixture string without
 * standing up a production-mode server.
 */

/**
 * Escape for both text and attribute context.
 *
 * Product names and descriptions are merchant-supplied and land inside
 * `content="…"`, so a stray quote would end the attribute and everything after
 * it would be parsed as markup. Single quotes are escaped too, because nothing
 * here guarantees which quote character a future edit uses.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Serialise JSON-LD for a `<script>` block.
 *
 * The escape is not decorative: a description containing `</script>` would
 * otherwise close the block early and the rest would be parsed as HTML.
 */
function jsonLdScript(data: object): string {
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

/**
 * The theme font's `<link>`s, or nothing at all.
 *
 * `preconnect` first, and only for a cross-origin stylesheet: the DNS lookup,
 * TCP handshake and TLS negotiation for a third-party font host cost more than
 * the stylesheet itself, and starting them a beat early is most of what makes
 * a web font arrive before first paint rather than after it. A same-origin
 * `/assets/` sheet is on a connection the browser already has, so preconnecting
 * to it would be a wasted line.
 *
 * The id matches what `ThemeVars` looks for, so the client adopts this element
 * instead of appending a second one. See shared/locale.ts.
 */
function fontTags(fontUrl: string | null, skipPreconnectOrigins: ReadonlySet<string>): string[] {
  if (!fontUrl) return [];

  const href = escapeHtml(fontUrl);
  const tags: string[] = [];

  if (!fontUrl.startsWith("/")) {
    try {
      // crossorigin, because font files are fetched in CORS mode whatever the
      // stylesheet was — a preconnect without it opens a connection the font
      // request cannot reuse, which is the common way this hint does nothing.
      const origin = new URL(fontUrl).origin;
      if (!skipPreconnectOrigins.has(origin)) {
        tags.push(`<link rel="preconnect" href="${escapeHtml(origin)}" crossorigin />`);
      }
    } catch {
      // Not a URL this can preconnect to. The stylesheet link below still
      // works, and a bad address was already refused at save time.
    }
  }

  tags.push(`<link id="${FONT_LINK_ID}" rel="stylesheet" href="${href}" />`);
  return tags;
}

/**
 * The card's own three faces (`CARD_FONTS_URL`), loaded regardless of the
 * store's theme — a store with no theme font, or one whose theme font is not
 * Google's, still has to render the back-of-card preview in the right face.
 *
 * `index.html` carries the same tag statically, so the built production shell
 * already has it before this ever runs; emitting it again would fetch the
 * stylesheet twice. Checked by id rather than assumed, so a shell that for
 * any reason lacks it — a fixture in a test, say — still gets one.
 */
function cardFontTags(alreadyPresent: boolean): string[] {
  if (alreadyPresent) return [];

  return [
    ...CARD_FONTS_ORIGINS.map((origin) => `<link rel="preconnect" href="${origin}" crossorigin />`),
    `<link id="${CARD_FONTS_LINK_ID}" rel="stylesheet" href="${escapeHtml(CARD_FONTS_URL)}" />`,
  ];
}

/**
 * Rewrite the shell's `<head>` for one page.
 *
 * The existing `<title>` and description are replaced rather than appended to:
 * two of either is worse than one wrong one, because a crawler picks whichever
 * it likes.
 */
export function injectMeta(html: string, meta: PageMeta): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  // Either this call adds the card fonts' own preconnects, or the shell
  // already carries them (see cardFontTags) — either way the theme's link
  // must not repeat one for the same origin.
  const cardFontsAlreadyPresent = html.includes(CARD_FONTS_LINK_ID);

  const tags = [
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    ...(meta.image ? [`<meta property="og:image" content="${escapeHtml(meta.image)}" />`] : []),
    ...(meta.jsonLd ? [jsonLdScript(meta.jsonLd)] : []),
    ...cardFontTags(cardFontsAlreadyPresent),
    ...fontTags(meta.fontUrl, new Set(CARD_FONTS_ORIGINS)),
  ].join("\n    ");

  return html
    .replace(/<html([^>]*)\slang="[^"]*"/i, "<html$1")
    .replace(/<html\b/i, `<html lang="${escapeHtml(meta.lang)}"`)
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
    .replace(
      /<meta\s+name="description"[^>]*>/i,
      `<meta name="description" content="${description}" />\n    ${tags}`,
    );
}
