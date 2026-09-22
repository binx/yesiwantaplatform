import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { designInputSchema, imageInputSchema } from "../../shared/api.js";
import {
  artistProfileInputSchema,
  artistStatusSchema,
  earningsSchema,
  mailingInputSchema,
  mailingUpdateInputSchema,
  nextMailDate,
  type Earnings,
} from "../../shared/platform.js";
import { postcardBackSchema, todayIso } from "../../shared/postcards.js";
import { artistShareCents } from "../../shared/schema.js";
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
  designIsUsed,
  getDesignForArtist,
  findDesignsByIds,
  listDesignsForArtist,
  toPublicDesign,
  updateDesignBack,
} from "../../db/designs-repository.js";
import {
  PeriodTakenError,
  cancelQueuedMailing,
  countPostcardsByMailing,
  createMailing,
  getMailingForArtist,
  listMailingsForArtist,
  setMailingInGallery,
  takenMailDates,
  updateQueuedMailing,
} from "../../db/mailings-repository.js";
import { listPostcardsForMailing } from "../../db/postcards-repository.js";
import { listSubscriptionsForArtist } from "../../db/subscriptions-repository.js";
import { listPayoutsForArtist, sumEarningsForArtist } from "../../db/payouts-repository.js";
import { findCustomerById } from "../auth.js";
import { createOnboardingLink, ensureConnectAccount, refreshConnectStatus } from "../connect.js";
import { httpError, requireCustomer, uploadRateLimit, verifyCsrf, writeRateLimit } from "../middleware.js";
import { classifyStripeError, StripeNotConfiguredError } from "../stripe.js";
import { deleteDesignFile, mapUploadError, storeImage, storePostcardDesign, uploadMiddleware } from "../uploads.js";
import { stripForCustomer, toArtistStudio, toMailing, toPayout, toSubscriber } from "../presenters.js";

/**
 * The studio: everything an artist does with their own page.
 *
 * A third authorization surface, layered on the customer's: `requireArtist`
 * needs a customer session *and* an artist row owned by it, and loads that
 * row once for every handler below. Nothing here takes an artist id from
 * the request — the signed-in person's own row is the only one in scope,
 * which is what makes another artist's design or mailing a 404 rather than
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
  if (error instanceof PeriodTakenError) throw httpError(409, error.message);
  if (error instanceof StripeNotConfiguredError) throw httpError(503, error.message);
  const stripeError = classifyStripeError(error);
  if (stripeError) throw httpError(stripeError.status, stripeError.message);
  throw error;
}

async function assertPriceAllowed(monthlyPriceCents: number): Promise<void> {
  const settings = await getSettings();
  const floor = settings?.pricing.minMonthlyPriceCents ?? 0;
  if (monthlyPriceCents < floor) {
    throw httpError(400, `The monthly price has to be at least ${(floor / 100).toFixed(2)} ${settings?.currency ?? "USD"}: below that a printed card costs more than it brings in.`);
  }
}

/** Become an artist: one page per account. */
studioRouter.post("/", async (req, res) => {
  const existing = await findArtistByCustomer(req.session.customerId!);
  if (existing) throw httpError(409, "You already have an artist page.");

  const parsed = artistProfileInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That profile could not be used.");
  await assertPriceAllowed(parsed.data.monthlyPriceCents);

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
  const [settings, counts, customer, mailings, earnings] = await Promise.all([
    getSettings(),
    countForArtists([artist.id]),
    findCustomerById(customerId),
    listMailingsForArtist(artist.id),
    sumEarningsForArtist(artist.id),
  ]);
  const currency = settings?.currency ?? "USD";
  const queued = mailings.filter((m) => m.status === "queued");
  return {
    artist: toArtistStudio(artist, customer?.email ?? "", counts.get(artist.id) ?? { subscribers: 0, mailed: 0 }, currency),
    queuedCount: queued.length,
    nextQueued: queued.sort((a, b) => a.mailDate.localeCompare(b.mailDate))[0]?.mailDate ?? null,
    nextMailDate: nextMailDate(artist.sendDay, mailings.map((m) => m.mailDate), todayIso()),
    earnings: { pendingCents: earnings.pendingCents, paidCents: earnings.paidCents, currency },
    pricing: settings?.pricing ?? null,
    /** What one card earns at this artist's current price. */
    shareCents: settings ? artistShareCents(artist.monthlyPriceCents, settings.pricing) : null,
  };
}

artistRouter.get("/", async (req, res) => {
  res.json(await studioView(artistOf(res), req.session.customerId!));
});

/* ---------------------------------------------------------------- profile */

artistRouter.put("/profile", async (req, res) => {
  const parsed = artistProfileInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That profile could not be used.");
  await assertPriceAllowed(parsed.data.monthlyPriceCents);

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
 */
function storeProfileImage(req: Request, res: Response, next: NextFunction): void {
  uploadMiddleware(req, res, (uploadError: unknown) => {
    void (async () => {
      try {
        if (uploadError) return next(mapUploadError(uploadError));
        if (!req.file) throw httpError(400, "No file was uploaded.");
        const { alt } = imageInputSchema.parse(req.body ?? {});
        const stored = await storeImage(`artists-${artistOf(res).id}`, req.file.buffer);
        res.status(201).json({ ...stored, alt });
      } catch (error) {
        next(error);
      }
    })();
  });
}

artistRouter.post("/avatar", uploadRateLimit, storeProfileImage);
artistRouter.post("/banner", uploadRateLimit, storeProfileImage);

/**
 * Go live, or pause. Going live needs a page worth visiting: a name, a
 * price the platform can print at, and at least one card in the queue so a
 * new subscriber is not paying for nothing.
 */
artistRouter.post("/status", async (req, res) => {
  const parsed = z.object({ status: artistStatusSchema.exclude(["draft"]) }).safeParse(req.body);
  if (!parsed.success) throw httpError(400, "Choose live or paused.");
  const artist = artistOf(res);

  if (parsed.data.status === "live" && artist.status !== "live") {
    await assertPriceAllowed(artist.monthlyPriceCents);
    const mailings = await listMailingsForArtist(artist.id);
    if (!mailings.some((m) => m.status === "queued")) {
      throw httpError(409, "Queue at least one postcard before going live, so your first subscriber has something coming.");
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
 * now rather than on the mailing day.
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

/** Edit the message. Refused once the card has been mailed: what was printed is the record. */
artistRouter.put("/designs/:id", async (req, res) => {
  const artist = artistOf(res);
  const parsed = postcardBackSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw httpError(400, first ? `${first.path.join(".")}: ${first.message}` : "Invalid message.");
  }

  const design = await getDesignForArtist(req.params.id, artist.id);
  if (!design) throw httpError(404, "No design found.");
  const { designIsMailed } = await import("../../db/designs-repository.js");
  if (await designIsMailed(design.id)) throw httpError(409, "That postcard has been mailed and can't be changed.");

  await updateDesignBack(design.id, artist.id, parsed.data);
  const updated = await getDesignForArtist(design.id, artist.id);
  res.json(toPublicDesign(updated!, `A postcard by ${artist.name}`));
});

/** Remove a design nothing refers to. */
artistRouter.delete("/designs/:id", async (req, res) => {
  const artist = artistOf(res);
  const design = await getDesignForArtist(req.params.id, artist.id);
  if (!design) throw httpError(404, "No design found.");
  if (await designIsUsed(design.id)) throw httpError(409, "That postcard is in your queue or has been mailed. Remove it from the queue first.");

  await deleteDesign(design.id);
  await deleteDesignFile(design.printPath).catch(() => undefined);
  await deleteDesignFile(design.thumbnailPath).catch(() => undefined);
  res.status(204).end();
});

/* --------------------------------------------------------------- mailings */

async function presentMailings(artist: ArtistRecord, ids?: string[]) {
  const mailings = (await listMailingsForArtist(artist.id)).filter((m) => !ids || ids.includes(m.id));
  const [designs, counts] = await Promise.all([findDesignsByIds(mailings.map((m) => m.designId)), countPostcardsByMailing(mailings.map((m) => m.id))]);
  const designById = new Map(designs.map((d) => [d.id, d]));
  return mailings.flatMap((mailing) => {
    const design = designById.get(mailing.designId);
    return design ? [toMailing(mailing, design, counts.get(mailing.id), artist.name)] : [];
  });
}

artistRouter.get("/mailings", async (_req, res) => {
  const artist = artistOf(res);
  res.json({ mailings: await presentMailings(artist), nextMailDate: nextMailDate(artist.sendDay, await takenMailDates(artist.id), todayIso()) });
});

/** How far out a card may be queued. */
const MAX_DAYS_AHEAD = 366;

function assertDateAllowed(mailDate: string): void {
  const today = todayIso();
  const horizon = new Date(Date.now() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (mailDate < today) throw httpError(400, "That day has passed. Pick today or later.");
  if (mailDate > horizon) throw httpError(400, "Postcards can be queued up to a year ahead.");
}

/** Queue a card. One per calendar month; the repository refuses a second. */
artistRouter.post("/mailings", async (req, res) => {
  const artist = artistOf(res);
  const parsed = mailingInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That could not be queued.");
  assertDateAllowed(parsed.data.mailDate);

  const design = await getDesignForArtist(parsed.data.designId, artist.id);
  if (!design) throw httpError(404, "No design found.");

  try {
    const mailing = await createMailing({ artistId: artist.id, designId: design.id, mailDate: parsed.data.mailDate, title: parsed.data.title, inGallery: parsed.data.inGallery });
    const [presented] = await presentMailings(artist, [mailing.id]);
    res.status(201).json(presented);
  } catch (error) {
    toHttp(error);
  }
});

/** Move a queued card, retitle it, or hide it from the gallery. */
artistRouter.put("/mailings/:id", async (req, res) => {
  const artist = artistOf(res);
  const parsed = mailingUpdateInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That could not be saved.");

  const mailing = await getMailingForArtist(req.params.id, artist.id);
  if (!mailing) throw httpError(404, "No mailing found.");

  try {
    if (mailing.status === "queued") {
      assertDateAllowed(parsed.data.mailDate);
      await updateQueuedMailing(mailing.id, artist.id, parsed.data);
    } else {
      // Gone already: only whether it shows in the gallery can change.
      await setMailingInGallery(mailing.id, artist.id, parsed.data.inGallery);
    }
  } catch (error) {
    toHttp(error);
  }

  const [presented] = await presentMailings(artist, [mailing.id]);
  res.json(presented);
});

/** Withdraw a queued card. A mailed one is history and stays. */
artistRouter.delete("/mailings/:id", async (req, res) => {
  const artist = artistOf(res);
  if (!(await cancelQueuedMailing(req.params.id, artist.id))) {
    throw httpError(409, "That mailing has already gone out, or does not exist.");
  }
  res.status(204).end();
});

/** Where each card of a mailing is. Lob's error text is stripped: the admin has it, the artist has "we're on it". */
artistRouter.get("/mailings/:id/postcards", async (req, res) => {
  const artist = artistOf(res);
  const mailing = await getMailingForArtist(req.params.id, artist.id);
  if (!mailing) throw httpError(404, "No mailing found.");
  const cards = await listPostcardsForMailing(mailing.id);
  res.json(cards.map((card) => ({ ...stripForCustomer(card), recipient: { ...card.recipient, line1: "", line2: null, postalCode: "" } })));
});

/* ------------------------------------------------------------ subscribers */

/** Who gets the mail: a name and a town each. The street is the platform's business, not the artist's. */
artistRouter.get("/subscribers", async (_req, res) => {
  const subscriptions = await listSubscriptionsForArtist(artistOf(res).id);
  res.json(subscriptions.map(toSubscriber));
});

/* --------------------------------------------------------------- earnings */

artistRouter.get("/earnings", async (_req, res) => {
  const artist = artistOf(res);
  const [settings, totals, payouts, counts] = await Promise.all([
    getSettings(),
    sumEarningsForArtist(artist.id),
    listPayoutsForArtist(artist.id),
    countForArtists([artist.id]),
  ]);
  const earnings: Earnings = earningsSchema.parse({
    currency: settings?.currency ?? "USD",
    pendingCents: totals.pendingCents,
    paidCents: totals.paidCents,
    sentCount: counts.get(artist.id)?.mailed ?? 0,
    payouts: payouts.map(toPayout),
  });
  res.json(earnings);
});

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
