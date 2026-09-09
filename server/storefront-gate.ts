import type { NextFunction, Request, Response } from "express";
import { getStorefrontState } from "../db/repository.js";

/**
 * The storefront password gate — see docs/tasks/27-storefront-preview-mode.md.
 *
 * Position, not an allow-list, decides what this covers: it is mounted in
 * `server/app.ts` after the webhook, the session and setup routers, the
 * crawler files and the built client bundle — each exempt by being above it —
 * and before every route that actually reads or writes store data. An
 * allow-list fails open for the next route somebody adds below it; a
 * positional choke point fails closed.
 */
export async function requireStorefrontAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // The merchant has to be able to reach the sign-in page and the wizard —
  // both are client routes, served by the HTML fallback below this gate.
  if (req.path === "/admin" || req.path.startsWith("/admin/")) return next();
  if (req.path === "/setup" || req.path.startsWith("/setup/")) return next();

  // An administrator has already proved more than the storefront password
  // proves, and `adminRouter` sits below this gate.
  if (req.session.adminId) return next();

  const state = await getStorefrontState();

  // No settings row at all means the store has never been set up — nothing
  // below this point has anything to protect yet, and `/setup` is exempt
  // above regardless.
  if (!state || state.access === "public") return next();

  if (req.session.storefrontAccess === state.accessVersion) return next();

  // Reached only when the request is refused. A link that leaks while the
  // store is locked should not be indexed on the strength of having leaked.
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  if (req.path.startsWith("/api/")) {
    res.status(401).json({ error: "This store is not open yet.", needsStorefrontPassword: true });
    return;
  }

  /*
   * Every other path gets the HTML shell, so the SPA can boot and render the
   * password form itself — there is no server-rendered second implementation
   * of that page to keep in step with the client one.
   *
   * The flag is how the production HTML handler (server/app.ts) knows to
   * skip `metaForPath` for this same request: without it, an anonymous
   * `GET /product/anything` would still get the product's name, price, image
   * and JSON-LD written into the head that is about to be sent, even though
   * nothing renders it. Set on `res.locals` rather than recomputed there,
   * so the two places cannot come to disagree about what is locked.
   */
  res.locals.storefrontLocked = true;
  next();
}
