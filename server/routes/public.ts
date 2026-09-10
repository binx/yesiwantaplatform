import { Router } from "express";
import { pageSchema } from "../../shared/schema.js";
import { getStoreSnapshot } from "../../db/repository.js";
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
    // Not an error: the store simply has not been set up yet.
    res.status(503).json({ error: "This store has not been set up yet.", needsSetup: true });
    return;
  }

  res.json(store);
});

publicRouter.get("/pages", async (_req, res) => {
  res.json(await listPageSummaries({ liveOnly: true }));
});

/**
 * One page, rendered. The Markdown source stays on the server; the client is
 * sent sanitised HTML. A draft is a 404 here and renders only in the admin.
 */
publicRouter.get("/pages/:slug", async (req, res) => {
  const page = await findPageBySlug(req.params.slug, true);
  if (!page) throw httpError(404, "Page not found.");

  res.json(pageSchema.parse({ ...page, bodyHtml: renderMarkdown(page.body) }));
});
