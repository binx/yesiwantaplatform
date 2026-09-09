import { getSettings } from "../db/repository.js";
import { fontUrlSchema } from "../shared/schema.js";
import { httpError, setCspFontOrigins } from "./middleware.js";
import { assertPublicHostname } from "./webhooks.js";

/**
 * Where a theme's font is allowed to come from.
 *
 * The theme editor has always offered a font stack, and a stack alone renders
 * only on a machine that already has the face installed. The missing half is a
 * stylesheet — and the reason a merchant could not simply add one is this
 * project's own CSP: `styleSrc` and `fontSrc` are `'self'`, so a Google Fonts
 * `<link>` was refused with a console error nobody outside a devtools panel
 * would ever see. This module is what lets exactly one chosen origin through
 * while everything else stays shut.
 *
 * The awkward part is Google Fonts, and it is the common case: the stylesheet
 * comes from `fonts.googleapis.com` and the `woff2` files it names come from
 * `fonts.gstatic.com`, which appears nowhere in the URL the merchant pasted.
 * Allow-listing the pair by name would work for Google and no one else, so the
 * second origin is discovered instead — fetch the stylesheet once, read the
 * `url()`s out of it, and allow what it actually asks for. That fetch doubles
 * as validation: a typo becomes a refusal at save time rather than a blank
 * font at run time.
 */

/** A stylesheet is a few kilobytes; anything slower than this is broken. */
const FETCH_TIMEOUT_MS = 5000;

/**
 * Google's `css2` response is ~2 KB, and a self-hosted `@font-face` sheet is
 * smaller. The cap is here so a URL pointing at something enormous costs a
 * bounded read rather than the process's memory — the body is a stranger's,
 * chosen by the merchant but served by someone else.
 */
const MAX_STYLESHEET_BYTES = 512 * 1024;

/**
 * A browser sends the stylesheet request with a UA, and Google Fonts answers
 * it: `css2` serves `woff2` to a modern browser and older formats to older
 * ones. Fetched without a UA, the reply names a different — sometimes empty —
 * set of files, and the origins read out of it would not be the origins the
 * browser is later refused. So this asks the way a browser would.
 */
const FETCH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Same cap as the webhook sender, and the same reason: a public origin can
 * still bounce the request somewhere the guard has not looked yet. */
const MAX_REDIRECTS = 3;

/**
 * The origins one `fontUrl` needs, resolved once.
 *
 * Keyed by the URL rather than held as a single current value, so switching a
 * store back to a font it used before is free, and so the resolution done at
 * save time is the one the CSP later reads — the merchant is never told the
 * URL is good by a save that then serves a header built from something else.
 */
const originsByUrl = new Map<string, readonly string[]>();

/** `https://fonts.googleapis.com/css2?family=X` → `https://fonts.googleapis.com`. */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * The `url(...)` targets in a stylesheet, as absolute origins.
 *
 * Deliberately a regex and not a CSS parser: the only thing needed from the
 * body is which hosts it points at, and a parser would have to be right about
 * every construct in a file this code does not otherwise care about. A `url()`
 * this misses costs a font that does not load — visible, and the same failure
 * as before this existed — while a parser that throws on an unusual sheet
 * would cost the merchant a save they had no way to fix.
 */
function referencedOrigins(css: string, base: string): string[] {
  const found = new Set<string>();

  for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    const reference = match[1]!.trim();
    // `data:` faces are inline bytes, already covered by `data:` in fontSrc.
    if (reference === "" || reference.startsWith("data:")) continue;

    let resolved: string | null;
    try {
      resolved = originOf(new URL(reference, base).toString());
    } catch {
      resolved = null;
    }
    if (resolved) found.add(resolved);
  }

  return [...found];
}

/**
 * Read a response body up to `maxBytes`, then stop — including cancelling the
 * connection, so an enormous body is a bounded read, not a bounded string cut
 * from one that was already downloaded in full.
 */
async function readCappedBody(response: Response, maxBytes: number): Promise<string> {
  // undici's ambient `Response.body` type leaves the stream's element type at
  // its default `any`; this is the one place that matters, so it is pinned
  // back to `Uint8Array` here rather than letting `any` spread into the loop.
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;

    const remaining = maxBytes - total;
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
    chunks.push(chunk);
    total += chunk.byteLength;
  }

  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetch a stylesheet, refusing private addresses on every hop.
 *
 * `redirect: "manual"` and a hand-rolled loop, the same shape as `send` in
 * server/webhooks.ts and for the same reason: `redirect: "follow"` would let
 * a public URL bounce the request to a private address with the guard having
 * only ever seen the first hop.
 */
async function fetchStylesheet(fontUrl: string): Promise<{ body: string; finalUrl: string }> {
  let target = fontUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const targetUrl = new URL(target);

    try {
      await assertPublicHostname(targetUrl.hostname);
    } catch {
      throw httpError(422, `${fontUrl} resolves to a private or reserved address.`);
    }

    let response: Response;
    try {
      response = await fetch(targetUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "text/css,*/*;q=0.1", "user-agent": FETCH_USER_AGENT },
      });
    } catch {
      throw httpError(
        422,
        `Could not fetch the font stylesheet at ${fontUrl}. Check the address.`,
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw httpError(
          422,
          `The font stylesheet at ${fontUrl} redirected without a destination.`,
        );
      }
      target = new URL(location, targetUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw httpError(
        422,
        `The font stylesheet at ${fontUrl} answered ${response.status}. Check the address.`,
      );
    }

    const body = await readCappedBody(response, MAX_STYLESHEET_BYTES);
    return { body, finalUrl: targetUrl.toString() };
  }

  throw httpError(422, `The font stylesheet at ${fontUrl} redirected too many times.`);
}

/**
 * Resolve the origins a font stylesheet needs, or refuse it.
 *
 * Throws a 422 naming the URL, because every caller is a merchant saving a
 * field they can correct — "we could not fetch this" with the address in it is
 * actionable in a way that a generic validation error is not.
 */
export async function resolveFontOrigins(
  fontUrl: string,
): Promise<readonly string[]> {
  const cached = originsByUrl.get(fontUrl);
  if (cached) return cached;

  /*
   * A self-hosted sheet under /assets/ is same-origin, which `'self'` already
   * covers — there is nothing to widen and nothing to fetch. It is also the
   * one case where fetching would be wrong: the server would be asking itself,
   * over a base URL that is only correct in production.
   */
  if (fontUrl.startsWith("/assets/")) {
    originsByUrl.set(fontUrl, []);
    return [];
  }

  const stylesheetOrigin = originOf(fontUrl);
  if (!stylesheetOrigin) {
    throw httpError(
      422,
      `${fontUrl} is not an https:// address or a path under /assets/.`,
    );
  }

  const { body, finalUrl } = await fetchStylesheet(fontUrl);

  /*
   * A redirect may have moved the sheet, and its relative `url()`s resolve
   * against where it ended up rather than where it was asked for. Both origins
   * are allowed for the same reason: the browser will follow the same hop.
   */
  const finalOrigin = originOf(finalUrl) ?? stylesheetOrigin;
  const origins = [
    ...new Set([
      stylesheetOrigin,
      finalOrigin,
      ...referencedOrigins(body, finalUrl),
    ]),
  ];

  originsByUrl.set(fontUrl, origins);
  return origins;
}

/**
 * Re-read the store's font and tell the CSP what it needs.
 *
 * Called once at startup and again after every settings save, which are the
 * only two moments the answer can change. It is deliberately not called per
 * request: the header is built on the hottest path in the app and must not
 * wait on a database read, let alone a network one.
 *
 * Never throws. Both callers are places where failing would be worse than a
 * narrow header — a store whose font host is unreachable at boot keeps the
 * policy it had, the font falls back to the next stack entry, and the next
 * save resolves it again.
 */
export async function refreshFontOrigins(): Promise<readonly string[]> {
  let origins: readonly string[] = [];

  try {
    const settings = await getSettings();
    const fontUrl = settings?.theme.fontUrl ?? null;
    if (fontUrl) origins = await resolveFontOrigins(fontUrl);
  } catch {
    origins = [];
  }

  setCspFontOrigins(origins);
  return origins;
}

/** Test seam: forget every resolution, and narrow the header back. */
export function resetFontOrigins(): void {
  originsByUrl.clear();
  setCspFontOrigins([]);
}

/**
 * Validate a theme's font URL, and warm the cache with the answer.
 *
 * Called from the settings and setup routes before the write, so the merchant
 * is told about a bad address instead of discovering it as a font that never
 * appears. Null is valid and costs nothing: a store with no font URL is a
 * store whose CSP is exactly what it was before this feature existed.
 */
export async function verifyFontUrl(fontUrl: string | null): Promise<void> {
  if (fontUrl === null) return;

  const parsed = fontUrlSchema.safeParse(fontUrl);
  if (!parsed.success) {
    throw httpError(
      422,
      `${fontUrl} is not an https:// address or a path under /assets/.`,
    );
  }

  await resolveFontOrigins(parsed.data);
}
