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
 * Rewrite the shell's `<head>` for one page.
 *
 * The existing `<title>` and description are replaced rather than appended to:
 * two of either is worse than one wrong one, because a crawler picks whichever
 * it likes.
 */
export function injectMeta(html: string, meta: PageMeta): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);

  const tags = [
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    ...(meta.image ? [`<meta property="og:image" content="${escapeHtml(meta.image)}" />`] : []),
    ...(meta.jsonLd ? [jsonLdScript(meta.jsonLd)] : []),
  ].join("\n    ");

  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
    .replace(
      /<meta\s+name="description"[^>]*>/i,
      `<meta name="description" content="${description}" />\n    ${tags}`,
    );
}
