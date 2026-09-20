import { Router } from "express";
import { pageSchema } from "../../shared/schema.js";
import { galleryPageSchema, type GalleryCard } from "../../shared/platform.js";
import { getSettings, getStoreSnapshot } from "../../db/repository.js";
import { findPageBySlug, listPageSummaries } from "../../db/pages-repository.js";
import { countForArtists, findArtistBySlug, findArtistsByIds, listArtists } from "../../db/artists-repository.js";
import { listGalleryMailings, type MailingRecord } from "../../db/mailings-repository.js";
import { findDesignsByIds } from "../../db/designs-repository.js";
import { renderMarkdown } from "../markdown.js";
import { httpError } from "../middleware.js";
import { summariseArtists, toGalleryCard, toPublicArtist } from "../presenters.js";

/**
 * Public reads. No authentication, no writes.
 *
 * Nothing here exposes a secret: the store payload carries the *publishable*
 * Stripe key, which is public by design, and never the secret key. Nothing
 * here exposes a subscriber either — an artist's page shows how many, never
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

/** The directory: every live artist, with how many people already get their mail. */
publicRouter.get("/artists", async (_req, res) => {
  const [settings, { artists }] = await Promise.all([getSettings(), listArtists({ status: "live" })]);
  res.json(await summariseArtists(artists, settings?.currency ?? "USD"));
});

/**
 * One artist's page. A draft is a 404 to everyone but its owner, who reads
 * it through the studio; a paused artist's page still renders, because
 * their subscribers still have somewhere to look.
 */
publicRouter.get("/artists/:slug", async (req, res) => {
  const artist = await findArtistBySlug(req.params.slug);
  if (!artist || artist.status === "draft") throw httpError(404, "No artist at this address.");

  const [settings, counts, recent] = await Promise.all([
    getSettings(),
    countForArtists([artist.id]),
    listGalleryMailings({ artistId: artist.id, limit: 12 }),
  ]);
  const cards = await presentGallery(recent.mailings);

  res.json({
    artist: toPublicArtist(artist, counts.get(artist.id), settings?.currency ?? "USD"),
    recent: cards,
  });
});

/* ---------------------------------------------------------------- gallery */

async function presentGallery(mailings: MailingRecord[]): Promise<GalleryCard[]> {
  const [designs, artists] = await Promise.all([
    findDesignsByIds(mailings.map((m) => m.designId)),
    findArtistsByIds(mailings.map((m) => m.artistId)),
  ]);
  const designById = new Map(designs.map((d) => [d.id, d]));
  const artistById = new Map(artists.map((a) => [a.id, a]));

  return mailings.flatMap((mailing) => {
    const design = designById.get(mailing.designId);
    const artist = artistById.get(mailing.artistId);
    // A draft artist's old cards are not shown either: the page they link to would 404.
    if (!design || !artist || artist.status === "draft") return [];
    return [toGalleryCard(mailing, design, artist)];
  });
}

/** Recently mailed cards, newest first, a page at a time. */
publicRouter.get("/gallery", async (req, res) => {
  const cursor = typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : undefined;
  const limit = Number(req.query.limit);
  const page = await listGalleryMailings({ ...(cursor ? { cursor } : {}), ...(Number.isFinite(limit) ? { limit } : {}) });
  res.json(galleryPageSchema.parse({ cards: await presentGallery(page.mailings), nextCursor: page.nextCursor }));
});
