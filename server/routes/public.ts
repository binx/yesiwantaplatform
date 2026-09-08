import { Router } from "express";
import { productQuerySchema } from "../../shared/api.js";
import { pageSchema } from "../../shared/schema.js";
import {
  findProductBySlug,
  getStoreSnapshot,
  listCollections,
  listProducts,
} from "../../db/repository.js";
import { findPageBySlug, listPageSummaries } from "../../db/pages-repository.js";
import { renderMarkdown } from "../markdown.js";
import { httpError } from "../middleware.js";

/**
 * Storefront reads. No authentication, no writes.
 *
 * Nothing here exposes a secret: the store payload carries the *publishable*
 * Stripe key, which is public by design, and never the secret key.
 */
export const publicRouter: Router = Router();

publicRouter.get("/store", async (_req, res) => {
  const store = await getStoreSnapshot();

  if (!store) {
    // Not an error: the store simply has not been set up yet. The client
    // shows the setup wizard rather than a crash — v1 threw on boot instead.
    res.status(503).json({ error: "This store has not been set up yet.", needsSetup: true });
    return;
  }

  res.json(store);
});

publicRouter.get("/collections", async (_req, res) => {
  res.json(await listCollections());
});

/** Paginated listing, for catalogues too large to ship in one payload. */
publicRouter.get("/products", async (req, res) => {
  const query = productQuerySchema.safeParse(req.query);
  if (!query.success) throw httpError(400, "Invalid query parameters.");

  const { collection, search, limit, offset } = query.data;

  res.json(
    await listProducts({
      // Drafts are never listed publicly, whatever the client asks for.
      liveOnly: true,
      ...(collection ? { collectionSlug: collection } : {}),
      ...(search ? { search } : {}),
      limit,
      offset,
    }),
  );
});

publicRouter.get("/products/:slug", async (req, res) => {
  const product = await findProductBySlug(req.params.slug, true);
  if (!product) throw httpError(404, "Product not found.");

  res.json(product);
});

/* ------------------------------------------------------------------- pages */

publicRouter.get("/pages", async (_req, res) => {
  res.json(await listPageSummaries({ liveOnly: true }));
});

/**
 * One page, rendered.
 *
 * The Markdown source stays on the server: the client is sent sanitised HTML,
 * so the storefront ships no parser and has nothing to decide about what it
 * has been handed. A draft is a 404 here and renders only in the admin.
 */
publicRouter.get("/pages/:slug", async (req, res) => {
  const page = await findPageBySlug(req.params.slug, true);
  if (!page) throw httpError(404, "Page not found.");

  // Parsed on the way out, which is also what drops `body` and `isLive`:
  // the Markdown source and the draft flag are the editor's business.
  res.json(pageSchema.parse({ ...page, bodyHtml: renderMarkdown(page.body) }));
});
