import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * Markdown to HTML, for store pages.
 *
 * Two decisions worth stating, because both are load-bearing:
 *
 *   - It runs on the server. The storefront is already fighting for kilobytes
 *     (see the chunking note in `vite.config.ts`), and a parser plus a
 *     sanitiser is a lot of JavaScript to send every shopper so that a returns
 *     policy can have bullet points.
 *   - It runs on the way *out*, never on the way in. Bodies are stored as
 *     Markdown, so tightening the allow-list below applies retroactively to
 *     everything already written. Storing rendered HTML would mean a fix
 *     reaches only pages saved after it.
 *
 * Page bodies are written by administrators, but that is not a reason to trust
 * them: task 07 made "administrator" a set of people a merchant invites, and
 * the output of this function renders on the storefront for every shopper.
 */

/**
 * Prose, and nothing else.
 *
 * No `script`, `style`, `iframe`, `object`, `form` or `img` — the tag has to
 * earn its place in a policy page, and every one of those is a way to make the
 * storefront do something other than read.
 */
const ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "a",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
] as const;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_TAGS],
  // Named explicitly, so an attribute is present only because someone decided
  // it should be. This is what keeps `onerror` and `style` out without needing
  // to enumerate them. `rel` and `target` are here because the transform below
  // adds them, and the filter runs *after* the transform — an attribute the
  // transform sets but the list does not name is stripped again.
  allowedAttributes: { a: ["href", "title", "rel", "target"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  disallowedTagsMode: "discard",
  /*
   * Tags whose text content goes with them.
   *
   * `script` is deliberately *not* in this list, unlike sanitize-html's
   * default. A discarded script tag then leaves its contents behind as escaped
   * text, so a merchant who pastes `<script>alert(1)</script>` sees the words
   * sitting inertly in their page and knows it did not work. Dropping it
   * silently is equally safe and much harder to debug. Style and the form tags
   * stay listed: their contents are not prose and would read as gibberish.
   */
  nonTextTags: ["style", "textarea", "option", "noscript"],
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href ?? "";
      // Relative and in-page links stay in the tab; anything leaving the store
      // opens elsewhere and carries no referral weight or opener handle.
      const internal = href.startsWith("/") || href.startsWith("#");

      return {
        tagName,
        attribs: internal
          ? attribs
          : { ...attribs, rel: "nofollow noopener noreferrer", target: "_blank" },
      };
    },
  },
};

export function renderMarkdown(markdown: string): string {
  // `async: false` narrows marked's return type to a string; the async path
  // exists for plugins and there are none here.
  return sanitizeHtml(marked.parse(markdown, { async: false, gfm: true }), OPTIONS);
}
