/**
 * Is this origin only reachable from the machine running the server?
 *
 * `PUBLIC_URL` is the origin behind Stripe's success and cancel URLs, the
 * sitemap and robots file, the canonical and Open Graph tags, and the links in
 * every email Beluga sends. It defaults to `http://localhost:5173`, and a
 * deploy that never set it fails silently: pages render, checkout reaches
 * Stripe, and the buyer is returned to an address that only exists on a
 * developer's laptop.
 *
 * Both places that warn about that — the setup wizard and the Overview — ask
 * the question here so they cannot disagree about what counts as local.
 * An unparseable value is not treated as local: it is a different problem, and
 * `server/env.ts` rejects it at boot before either screen can render.
 */
export function isLocalOrigin(publicUrl: string): boolean {
  let hostname: string;
  try {
    ({ hostname } = new URL(publicUrl));
  } catch {
    return false;
  }

  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
