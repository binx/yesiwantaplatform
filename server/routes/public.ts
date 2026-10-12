import { Router } from "express";
import { pageSchema } from "../../shared/schema.js";
import { galleryPageSchema, type GalleryCard } from "../../shared/platform.js";
import { getSettings, getStoreSnapshot } from "../../db/repository.js";
import { findPageBySlug, listPageSummaries } from "../../db/pages-repository.js";
import { countForArtists, findArtistBySlug, findArtistsByIds, listArtists } from "../../db/artists-repository.js";
import { findEditionBySlug, listEditionsForArtist, listGalleryCards, type GalleryEntry } from "../../db/editions-repository.js";
import { findDesignsByIds } from "../../db/designs-repository.js";
import { renderMarkdown } from "../markdown.js";
import { httpError } from "../middleware.js";
import { presentEditions, summariseArtists, summariseEditions, toGalleryCard, toPublicArtist } from "../presenters.js";

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

/** The directory: every live artist, with how many people collect them and what their editions start at. */
publicRouter.get("/artists", async (_req, res) => {
  const [settings, { artists }] = await Promise.all([getSettings(), listArtists({ status: "live" })]);
  res.json(await summariseArtists(artists, settings?.currency ?? "USD"));
});

/**
 * One artist's page: who they are, their editions on sale and closed, and
 * their recently mailed cards. A draft is a 404 to everyone but its owner,
 * who reads it through the studio; a paused artist's page still renders,
 * because their collectors still have somewhere to look.
 */
publicRouter.get("/artists/:slug", async (req, res) => {
  const artist = await findArtistBySlug(req.params.slug);
  if (!artist || artist.status === "draft") throw httpError(404, "No artist at this address.");

  const [settings, counts, recent, editions] = await Promise.all([
    getSettings(),
    countForArtists([artist.id]),
    listGalleryCards({ artistId: artist.id, limit: 12 }),
    listEditionsForArtist(artist.id, ["on_sale", "closed"]),
  ]);
  const currency = settings?.currency ?? "USD";
  // Their own page shows their own cards whatever their visibility: private
  // keeps them out of the shared feed, not off the page a visitor came for.
  const cards = await presentGallery(recent.entries, { feed: false });

  res.json({
    artist: toPublicArtist(artist, counts.get(artist.id), currency),
    editions: await summariseEditions(editions, currency, artist.name),
    recent: cards,
  });
});

/**
 * One edition, every card of it. A draft is a 404, like a draft artist; a
 * closed edition still renders, for the people collecting it.
 */
publicRouter.get("/artists/:slug/editions/:edition", async (req, res) => {
  const artist = await findArtistBySlug(req.params.slug);
  if (!artist || artist.status === "draft") throw httpError(404, "No artist at this address.");
  const edition = await findEditionBySlug(artist.id, req.params.edition);
  if (!edition || edition.status === "draft") throw httpError(404, "No edition at this address.");

  const [settings, counts] = await Promise.all([getSettings(), countForArtists([artist.id])]);
  const currency = settings?.currency ?? "USD";
  const [presented] = await presentEditions([edition], currency, artist.name);
  res.json({ artist: toPublicArtist(artist, counts.get(artist.id), currency), edition: presented });
});

/* ---------------------------------------------------------------- gallery */

/**
 * `feed` is the shared gallery: a private artist's cards are left out of
 * it. Their own page passes false and shows them.
 */
async function presentGallery(entries: GalleryEntry[], { feed }: { feed: boolean }): Promise<GalleryCard[]> {
  const [designs, artists] = await Promise.all([
    findDesignsByIds(entries.map((entry) => entry.card.designId)),
    findArtistsByIds(entries.map((entry) => entry.edition.artistId)),
  ]);
  const designById = new Map(designs.map((d) => [d.id, d]));
  const artistById = new Map(artists.map((a) => [a.id, a]));

  return entries.flatMap((entry) => {
    const design = designById.get(entry.card.designId);
    const artist = artistById.get(entry.edition.artistId);
    // A draft artist's old cards are not shown either: the page they link to would 404.
    if (!design || !artist || artist.status === "draft") return [];
    if (feed && artist.visibility === "private") return [];
    return [toGalleryCard(entry, design, artist)];
  });
}

/** Recently mailed cards, newest first, a page at a time. */
publicRouter.get("/gallery", async (req, res) => {
  const cursor = typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : undefined;
  const limit = Number(req.query.limit);
  const page = await listGalleryCards({ ...(cursor ? { cursor } : {}), ...(Number.isFinite(limit) ? { limit } : {}) });
  res.json(galleryPageSchema.parse({ cards: await presentGallery(page.entries, { feed: true }), nextCursor: page.nextCursor }));
});
