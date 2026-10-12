import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { designInputSchema, imageInputSchema } from "../../shared/api.js";
import {
  artistProfileInputSchema,
  artistStatusSchema,
  editionCardsInputSchema,
  editionInputSchema,
  editionStatusSchema,
  type EditionInput,
} from "../../shared/platform.js";
import { postcardBackSchema } from "../../shared/postcards.js";
import { getSettings } from "../../db/repository.js";
import { SlugTakenError } from "../../db/admin-repository.js";
import {
  countForArtists,
  createArtist,
  findArtistByCustomer,
  getArtist,
  setArtistStatus,
  slugIsTaken,
  updateArtistProfile,
  type ArtistRecord,
} from "../../db/artists-repository.js";
import {
  createDesign,
  deleteDesign,
  designIsLocked,
  designIsUsed,
  getDesignForArtist,
  findDesignsByIds,
  listDesignsForArtist,
  toPublicDesign,
  updateDesignBack,
} from "../../db/designs-repository.js";
import {
  EditionSlugTakenError,
  createEdition,
  deleteDraftEdition,
  getEditionForArtist,
  listCardsForEdition,
  listEditionsForArtist,
  replaceEditionCards,
  setEditionStatus,
  updateDraftEdition,
  updateEditionWords,
  type EditionRecord,
} from "../../db/editions-repository.js";
import { editionHasPurchases } from "../../db/purchases-repository.js";
import { sumEarningsForArtist } from "../../db/payouts-repository.js";
import { findCustomerById } from "../auth.js";
import { createOnboardingLink, ensureConnectAccount, refreshConnectStatus } from "../connect.js";
import { httpError, requireCustomer, uploadRateLimit, verifyCsrf, writeRateLimit } from "../middleware.js";
import { classifyStripeError, StripeNotConfiguredError } from "../stripe.js";
import { deleteDesignFile, mapUploadError, storeImage, storePostcardDesign, uploadMiddleware } from "../uploads.js";
import { presentStudioEditions, toArtistStudio } from "../presenters.js";

/**
 * The studio: everything an artist does with their own page.
 *
 * A third authorization surface, layered on the customer's: `requireArtist`
 * needs a customer session *and* an artist row owned by it, and loads that
 * row once for every handler below. Nothing here takes an artist id from
 * the request — the signed-in person's own row is the only one in scope,
 * which is what makes another artist's design or edition a 404 rather than
 * a bug waiting for someone to remove a comparison.
 */
export const studioRouter: Router = Router();

studioRouter.use(writeRateLimit, verifyCsrf, requireCustomer);

/** A slug's availability, for the profile form as the artist types. */
studioRouter.get("/slug/:slug", async (req, res) => {
  const slug = z.string().max(80).parse(req.params.slug);
  const own = await findArtistByCustomer(req.session.customerId!);
  res.json({ available: artistProfileInputSchema.shape.slug.safeParse(slug).success && !(await slugIsTaken(slug, own?.id)) });
});

function toHttp(error: unknown): never {
  if (error instanceof SlugTakenError) throw httpError(409, error.message);
  if (error instanceof EditionSlugTakenError) throw httpError(409, error.message);
  if (error instanceof StripeNotConfiguredError) throw httpError(503, error.message);
  const stripeError = classifyStripeError(error);
  if (stripeError) throw httpError(stripeError.status, stripeError.message);
  throw error;
}

/** The floor is per card, so a set of twelve has twice the floor of a set of six. */
async function assertPriceAllowed(input: Pick<EditionInput, "priceCents" | "cardCount">): Promise<void> {
  const settings = await getSettings();
  const floor = (settings?.pricing.minCardPriceCents ?? 0) * input.cardCount;
  if (input.priceCents < floor) {
    throw httpError(
      400,
      `A set of ${input.cardCount} has to cost at least ${(floor / 100).toFixed(2)} ${settings?.currency ?? "USD"}: below that a printed card costs more than it brings in.`,
    );
  }
}

/** Become an artist: one page per account. */
studioRouter.post("/", async (req, res) => {
  const existing = await findArtistByCustomer(req.session.customerId!);
  if (existing) throw httpError(409, "You already have an artist page.");

  const parsed = artistProfileInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That profile could not be used.");

  try {
    const artist = await createArtist(req.session.customerId!, parsed.data);
    res.status(201).json(await studioView(artist, req.session.customerId!));
  } catch (error) {
    toHttp(error);
  }
});

/* ------------------------------------------------------- the artist gate */

interface ArtistLocals {
  artist: ArtistRecord;
}

/** Load the signed-in customer's artist row, or refuse. Runs after `requireCustomer`. */
async function requireArtist(req: Request, res: Response, next: NextFunction): Promise<void> {
  const artist = await findArtistByCustomer(req.session.customerId!);
  if (!artist) {
    res.status(404).json({ error: "You don't have an artist page yet.", needsArtist: true });
    return;
  }
  (res.locals as ArtistLocals).artist = artist;
  next();
}

const artistRouter: Router = Router();
artistRouter.use((req, res, next) => void requireArtist(req, res, next).catch(next));

function artistOf(res: Response): ArtistRecord {
  return (res.locals as ArtistLocals).artist;
}

async function studioView(artist: ArtistRecord, customerId: string) {
  const [settings, counts, customer, editions, earnings] = await Promise.all([
    getSettings(),
    countForArtists([artist.id]),
    findCustomerById(customerId),
    listEditionsForArtist(artist.id),
    sumEarningsForArtist(artist.id),
  ]);
  const currency = settings?.currency ?? "USD";
  return {
    artist: toArtistStudio(artist, customer?.email ?? "", counts.get(artist.id) ?? { collectors: 0, mailed: 0 }, currency),
    editionCounts: {
      draft: editions.filter((edition) => edition.status === "draft").length,
      onSale: editions.filter((edition) => edition.status === "on_sale").length,
      closed: editions.filter((edition) => edition.status === "closed").length,
    },
    earnings: { pendingCents: earnings.pendingCents, paidCents: earnings.paidCents, currency },
    pricing: settings?.pricing ?? null,
  };
}

artistRouter.get("/", async (req, res) => {
  res.json(await studioView(artistOf(res), req.session.customerId!));
});

/* ---------------------------------------------------------------- profile */

artistRouter.put("/profile", async (req, res) => {
  const parsed = artistProfileInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That profile could not be used.");

  try {
    const artist = await updateArtistProfile(artistOf(res).id, parsed.data);
    res.json(await studioView(artist, req.session.customerId!));
  } catch (error) {
    toHttp(error);
  }
});

/**
 * Stores a profile picture and hands the image back; it is persisted with
 * the profile on Save. The avatar and the banner are the same upload with
 * different homes on the page, so they share one handler.
 *
 * Needs a customer, not an artist: the banner is required to open a studio,
 * so it is uploaded before the artist row exists. Files are kept under the
 * customer's id for that reason.
 */
function storeProfileImage(req: Request, res: Response, next: NextFunction): void {
  uploadMiddleware(req, res, (uploadError: unknown) => {
    void (async () => {
      try {
        if (uploadError) return next(mapUploadError(uploadError));
        if (!req.file) throw httpError(400, "No file was uploaded.");
        const { alt } = imageInputSchema.parse(req.body ?? {});
        const stored = await storeImage(`profile-${req.session.customerId!}`, req.file.buffer);
        res.status(201).json({ ...stored, alt });
      } catch (error) {
        next(error);
      }
    })();
  });
}

studioRouter.post("/avatar", uploadRateLimit, storeProfileImage);
studioRouter.post("/banner", uploadRateLimit, storeProfileImage);

/**
 * Go live, or pause. Going live needs a page worth visiting: at least one
 * edition on sale, so a visitor has something to collect.
 */
artistRouter.post("/status", async (req, res) => {
  const parsed = z.object({ status: artistStatusSchema.exclude(["draft"]) }).safeParse(req.body);
  if (!parsed.success) throw httpError(400, "Choose live or paused.");
  const artist = artistOf(res);

  if (parsed.data.status === "live" && artist.status !== "live") {
    const onSale = await listEditionsForArtist(artist.id, ["on_sale"]);
    if (onSale.length === 0) {
      throw httpError(409, "Put an edition on sale before going live, so your first visitor has something to collect.");
    }
  }

  await setArtistStatus(artist.id, parsed.data.status);
  const updated = await getArtist(artist.id);
  res.json(await studioView(updated ?? artist, req.session.customerId!));
});

/* ---------------------------------------------------------------- designs */

artistRouter.get("/designs", async (_req, res) => {
  const artist = artistOf(res);
  const designs = await listDesignsForArtist(artist.id);
  res.json(designs.map((design) => toPublicDesign(design, `A postcard by ${artist.name}`)));
});

/** A multipart text field holding JSON. Absent or empty means "not given". */
function parseJsonField(value: unknown, message: string): unknown {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw httpError(400, message);
  }
}

/**
 * Save a design: the front image as multipart `file`, plus `orientation`,
 * `back` and `crop` (JSON strings) as fields. The print file is made here,
 * at Lob's size and density, so an image that cannot be printed is refused
 * now rather than on the day it is due to go.
 */
artistRouter.post("/designs", uploadRateLimit, (req, res, next) => {
  uploadMiddleware(req, res, (uploadError: unknown) => {
    void (async () => {
      try {
        if (uploadError) return next(mapUploadError(uploadError));
        if (!req.file) throw httpError(400, "Choose an image for the front of the card.");

        const body = req.body as Record<string, unknown>;
        const back = parseJsonField(body.back, "The back of the card could not be read.");
        const crop = parseJsonField(body.crop, "The photo's position could not be read.");

        const parsed = designInputSchema.safeParse({ orientation: body.orientation, back: back ?? {}, ...(crop === undefined ? {} : { crop }) });
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          throw httpError(400, first ? `${first.path.join(".")}: ${first.message}` : "Invalid design.");
        }

        const artist = artistOf(res);
        const id = randomUUID();
        const stored = await storePostcardDesign(id, req.file.buffer, parsed.data.orientation, parsed.data.crop);

        try {
          const design = await createDesign({ artistId: artist.id, orientation: parsed.data.orientation, back: parsed.data.back, ...stored }, id);
          res.status(201).json(toPublicDesign(design, `A postcard by ${artist.name}`));
        } catch (error) {
          // The files are on disk and the row is not: remove them rather than leave two orphans.
          await deleteDesignFile(stored.printPath).catch(() => undefined);
          await deleteDesignFile(stored.thumbnailPath).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        next(error);
      }
    })();
  });
});

/** Edit the message. Refused once the card is in an edition on sale: collectors paid for it as it is. */
artistRouter.put("/designs/:id", async (req, res) => {
  const artist = artistOf(res);
  const parsed = postcardBackSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw httpError(400, first ? `${first.path.join(".")}: ${first.message}` : "Invalid message.");
  }

  const design = await getDesignForArtist(req.params.id, artist.id);
  if (!design) throw httpError(404, "No design found.");
  if (await designIsLocked(design.id)) throw httpError(409, "That postcard is in an edition on sale and can't be changed.");

  await updateDesignBack(design.id, artist.id, parsed.data);
  const updated = await getDesignForArtist(design.id, artist.id);
  res.json(toPublicDesign(updated!, `A postcard by ${artist.name}`));
});

/** Remove a design nothing refers to. */
artistRouter.delete("/designs/:id", async (req, res) => {
  const artist = artistOf(res);
  const design = await getDesignForArtist(req.params.id, artist.id);
  if (!design) throw httpError(404, "No design found.");
  if (await designIsUsed(design.id)) throw httpError(409, "That postcard is in one of your editions. Take it out of the edition first.");

  await deleteDesign(design.id);
  await deleteDesignFile(design.printPath).catch(() => undefined);
  await deleteDesignFile(design.thumbnailPath).catch(() => undefined);
  res.status(204).end();
});

/* --------------------------------------------------------------- editions */

async function presentOne(artist: ArtistRecord, edition: EditionRecord) {
  const settings = await getSettings();
  const [presented] = await presentStudioEditions([edition], settings?.currency ?? "USD", artist.name);
  return presented;
}

async function editionOf(res: Response, id: string): Promise<EditionRecord> {
  const edition = await getEditionForArtist(id, artistOf(res).id);
  if (!edition) throw httpError(404, "No edition found.");
  return edition;
}

artistRouter.get("/editions", async (_req, res) => {
  const artist = artistOf(res);
  const settings = await getSettings();
  res.json(await presentStudioEditions(await listEditionsForArtist(artist.id), settings?.currency ?? "USD", artist.name));
});

artistRouter.get("/editions/:id", async (req, res) => {
  const edition = await editionOf(res, req.params.id);
  res.json(await presentOne(artistOf(res), edition));
});

/** Start an edition, as a draft. Its cards come next. */
artistRouter.post("/editions", async (req, res) => {
  const artist = artistOf(res);
  const parsed = editionInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That edition could not be used.");
  await assertPriceAllowed(parsed.data);

  try {
    const edition = await createEdition(artist.id, parsed.data);
    res.status(201).json(await presentOne(artist, edition));
  } catch (error) {
    toHttp(error);
  }
});

/**
 * Change an edition. A draft can change anything; past that only its words
 * can, because collectors paid for the cards, size and price as
 * they are. A change to those on a sold edition is refused rather than
 * quietly dropped.
 */
artistRouter.put("/editions/:id", async (req, res) => {
  const artist = artistOf(res);
  const edition = await editionOf(res, req.params.id);
  const parsed = editionInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That edition could not be used.");

  try {
    if (edition.status === "draft") {
      await assertPriceAllowed(parsed.data);
      if (!(await updateDraftEdition(edition.id, artist.id, parsed.data))) throw httpError(409, "That edition has just gone on sale. Reload and try again.");
    } else {
      const fixed =
        parsed.data.slug !== edition.slug ||
        parsed.data.cardCount !== edition.cardCount ||
        parsed.data.priceCents !== edition.priceCents;
      if (fixed) throw httpError(409, "This edition is on sale, so its address, size and price are fixed. Its title, description and banner can still change.");
      if (!parsed.data.banner) throw httpError(409, "An edition on sale needs a banner: it's what visitors see in place of the cards. Choose a new one instead.");
      await updateEditionWords(edition.id, artist.id, parsed.data);
    }
  } catch (error) {
    toHttp(error);
  }

  res.json(await presentOne(artist, (await getEditionForArtist(edition.id, artist.id)) ?? edition));
});

/** Stores an edition's banner and hands the image back; it is saved with the edition. */
artistRouter.post("/editions/banner", uploadRateLimit, storeProfileImage);

/** Set a draft's cards, in order. Every design must be the artist's own. */
artistRouter.put("/editions/:id/cards", async (req, res) => {
  const artist = artistOf(res);
  const edition = await editionOf(res, req.params.id);
  const parsed = editionCardsInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "Those cards could not be used.");
  if (edition.status !== "draft") throw httpError(409, "This edition is on sale, so its cards are fixed.");
  if (parsed.data.cards.length > edition.cardCount) throw httpError(400, `This edition holds ${edition.cardCount} cards.`);

  const designs = await findDesignsByIds(parsed.data.cards.map((card) => card.designId));
  if (designs.length !== parsed.data.cards.length || designs.some((design) => design.artistId !== artist.id)) {
    throw httpError(404, "No design found.");
  }

  if (!(await replaceEditionCards(edition.id, parsed.data.cards))) throw httpError(409, "That edition has just gone on sale. Reload and try again.");
  res.json(await presentOne(artist, edition));
});

/**
 * Move an edition along.
 *
 *   on_sale  needs every card in place, a banner, and a price the platform can print at
 *   draft    only while nobody has bought it, even an abandoned checkout
 *   closed   from on sale; collectors who paid still get every card
 */
artistRouter.post("/editions/:id/status", async (req, res) => {
  const artist = artistOf(res);
  const edition = await editionOf(res, req.params.id);
  const parsed = z.object({ status: editionStatusSchema }).safeParse(req.body);
  if (!parsed.success) throw httpError(400, "Choose draft, on sale or closed.");
  const to = parsed.data.status;
  let moved: boolean;

  if (to === "on_sale") {
    const cards = await listCardsForEdition(edition.id);
    if (cards.length !== edition.cardCount) {
      throw httpError(409, `Add all ${edition.cardCount} cards before putting this edition on sale. It has ${cards.length}.`);
    }
    // The cards are a surprise, so the banner is what a visitor sees instead.
    if (!edition.banner) throw httpError(409, "Add a banner before putting this edition on sale: it's what visitors see in place of the cards.");
    await assertPriceAllowed(edition);
    moved = await setEditionStatus(edition.id, ["draft", "closed"], "on_sale");
  } else if (to === "draft") {
    if (edition.status !== "draft" && (await editionHasPurchases(edition.id))) {
      throw httpError(409, "Someone has bought this edition, or is checking out with it now, so it can't go back to being a draft. Close it instead, and start a new one.");
    }
    moved = await setEditionStatus(edition.id, ["on_sale", "closed"], "draft");
  } else {
    moved = await setEditionStatus(edition.id, ["on_sale"], "closed");
  }
  if (!moved) throw httpError(409, "That edition can't move there from where it is now. Reload and try again.");

  res.json(await presentOne(artist, (await getEditionForArtist(edition.id, artist.id)) ?? edition));
});

/** Remove a draft nobody has bought. Its designs stay, to be used again. */
artistRouter.delete("/editions/:id", async (req, res) => {
  const artist = artistOf(res);
  const edition = await editionOf(res, req.params.id);
  if (edition.status !== "draft" || (await editionHasPurchases(edition.id))) {
    throw httpError(409, "Only a draft nobody has bought can be deleted. Close it instead.");
  }
  if (!(await deleteDraftEdition(edition.id, artist.id))) throw httpError(409, "That edition has just gone on sale.");
  res.status(204).end();
});

/* ---------------------------------------------------------------- payouts */

/** Start (or resume) Stripe onboarding: answers with the hosted link to send the artist to. */
artistRouter.post("/payouts/onboard", async (req, res) => {
  const artist = artistOf(res);
  const customer = await findCustomerById(req.session.customerId!);
  try {
    const accountId = await ensureConnectAccount(artist, customer?.email ?? "");
    res.json({ url: await createOnboardingLink(accountId) });
  } catch (error) {
    toHttp(error);
  }
});

/** Ask Stripe whether the account can be paid yet. */
artistRouter.post("/payouts/refresh", async (_req, res) => {
  try {
    res.json({ payoutsEnabled: await refreshConnectStatus(artistOf(res)) });
  } catch (error) {
    toHttp(error);
  }
});

studioRouter.use(artistRouter);
