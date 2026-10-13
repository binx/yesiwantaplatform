import { Router } from "express";
import { pageSchema } from "../../shared/schema.js";
import { galleryPageSchema } from "../../shared/platform.js";
import { getSettings, getStoreSnapshot } from "../../db/repository.js";
import { findPageBySlug, listPageSummaries } from "../../db/pages-repository.js";
import { countForArtists, findArtistBySlug, listArtists } from "../../db/artists-repository.js";
import { findEditionBySlug, listEditionsForArtist, listGalleryEditions } from "../../db/editions-repository.js";
import { renderMarkdown } from "../markdown.js";
import { httpError } from "../middleware.js";
import { presentEditions, presentGalleryEditions, summariseArtists, summariseEditions, toPublicArtist } from "../presenters.js";

/**
 * Public reads. No authentication, no writes.
 *
 * Nothing here exposes a secret: the store payload carries the *publishable*
 * Stripe key, which is public by design, and never the secret key. Nothing
 * here exposes a collector either — an artist's page shows how many, never
 * who.
 */
export const publicRouter: Router = Router();

publicRouter.get("/store", async (_req, res) => {
  const store = await getStoreSnapshot();

  if (!store) {
    // Not an error: the platform simply has not been set up yet.
    res.status(503).json({ error: "This platform has not been set up yet.", needsSetup: true });
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

/* ---------------------------------------------------------------- artists */

/**
 * The directory: every live artist with an edition on sale, with how many
 * people collect them and what their editions start at. Live with nothing
 * on sale is a page with nothing to collect, so it is left out.
 */
publicRouter.get("/artists", async (_req, res) => {
  const [settings, { artists }] = await Promise.all([getSettings(), listArtists({ status: "live" })]);
  const summaries = await summariseArtists(artists, settings?.currency ?? "USD");
  res.json(summaries.filter((artist) => artist.editionCount > 0));
});

/**
 * One artist's page: who they are, and their editions on sale and closed.
 * Never the cards they have mailed — those are the surprise. A draft is a
 * 404 to everyone but its owner, who reads it through the studio; a paused
 * artist's page still renders, because their collectors still have
 * somewhere to look.
 */
publicRouter.get("/artists/:slug", async (req, res) => {
  const artist = await findArtistBySlug(req.params.slug);
  if (!artist || artist.status === "draft") throw httpError(404, "No artist at this address.");

  const [settings, counts, editions] = await Promise.all([getSettings(), countForArtists([artist.id]), listEditionsForArtist(artist.id, ["on_sale", "closed"])]);
  const currency = settings?.currency ?? "USD";

  res.json({
    artist: toPublicArtist(artist, counts.get(artist.id), currency),
    editions: await summariseEditions(editions, currency),
  });
});

/**
 * One edition. A draft, or one in review, is a 404, like a draft artist; a
 * closed edition still renders, for the people collecting it.
 */
publicRouter.get("/artists/:slug/editions/:edition", async (req, res) => {
  const artist = await findArtistBySlug(req.params.slug);
  if (!artist || artist.status === "draft") throw httpError(404, "No artist at this address.");
  const edition = await findEditionBySlug(artist.id, req.params.edition);
  if (!edition || (edition.status !== "on_sale" && edition.status !== "closed")) throw httpError(404, "No edition at this address.");

  const [settings, counts] = await Promise.all([getSettings(), countForArtists([artist.id])]);
  const currency = settings?.currency ?? "USD";
  const [presented] = await presentEditions([edition], currency);
  res.json({ artist: toPublicArtist(artist, counts.get(artist.id), currency), edition: presented });
});

/* ---------------------------------------------------------------- gallery */

/**
 * The gallery: editions on sale from live, public artists, newest first, a
 * page at a time. A private artist's editions stay on their own page.
 */
publicRouter.get("/gallery", async (req, res) => {
  const cursor = typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : undefined;
  const limit = Number(req.query.limit);
  const [settings, page] = await Promise.all([getSettings(), listGalleryEditions({ ...(cursor ? { cursor } : {}), ...(Number.isFinite(limit) ? { limit } : {}) })]);
  res.json(galleryPageSchema.parse({ editions: await presentGalleryEditions(page.editions, settings?.currency ?? "USD"), nextCursor: page.nextCursor }));
});

