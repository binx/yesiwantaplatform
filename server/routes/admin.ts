import { Router } from "express";
import { ZodError, z } from "zod";
import {
  imageInputSchema,
  pageInputSchema,
  pagePreviewInputSchema,
  reorderInputSchema,
  passwordChangeInputSchema,
  settingsInputSchema,
  type EmailTestResult,
  type EnvironmentStatus,
  type LobTestResult,
} from "../../shared/api.js";
import { artistStatusSchema, editionStatusSchema, payoutStatusSchema, purchaseStatusSchema, reviewInputSchema } from "../../shared/platform.js";
import { SlugTakenError, updateSettings } from "../../db/admin-repository.js";
import { getSettings } from "../../db/repository.js";
import { createPage, deletePage, listPageDrafts, pageExists, reorderPages, updatePage } from "../../db/pages-repository.js";
import { countArtistsByStatus, countForArtists, findArtistsByIds, getArtist, listArtists, reviewArtist, setArtistStatus, type ArtistRecord } from "../../db/artists-repository.js";
import { countEditionsByStatus, getEdition, listEditions, listEditionsForArtist, reviewEdition, type EditionRecord } from "../../db/editions-repository.js";
import { cancelPostcard, countPostcardsByStatus, getPostcard, listPostcardsByStatus, listPostcardsForEdition, requeuePostcard } from "../../db/postcards-repository.js";
import { countPurchasesByStatus, listPurchases, listPurchasesForArtist, listPurchasesForEdition, sumRevenueCents, type PurchaseRecord } from "../../db/purchases-repository.js";
import { listPayouts, requeuePayout, sumPayoutsByStatus } from "../../db/payouts-repository.js";
import { getDatabase } from "../../db/client.js";
import { refreshFontOrigins, verifyFontUrl } from "../fonts.js";
import { adminLoginRateLimit, emailRateLimit, httpError, requireAdmin, verifyCsrf, writeRateLimit } from "../middleware.js";
import { env, hasLob, hasLobWebhook, hasStripe, isProduction, isSqlite, lobMode } from "../env.js";
import { mapUploadError, storeImage, uploadMiddleware } from "../uploads.js";
import { StripeNotConfiguredError, classifyStripeError, getStripeKeyCheck } from "../stripe.js";
import { renderMarkdown } from "../markdown.js";
import { escapeHtml } from "../html.js";
import { sendEmailReportingFailure, sendReviewDecisionEmail } from "../email.js";
import { LobError, LobNotConfiguredError, sendTestPostcard } from "../lob.js";
import { getLastPayoutSweep, getLastSweep, sendDuePostcards, sendPendingPayouts } from "../fulfilment.js";
import { presentCollections, presentStudioEditions, toPayout, toPublicArtist } from "../presenters.js";
import { destroySessionsForUser, findAdminById, findCustomerById, updateAdminPassword, verifyPasswordFor } from "../auth.js";
import { toEpochMs } from "../../db/repository.js";
import { desc } from "drizzle-orm";

/**
 * Admin API — the platform operator's view.
 *
 * Every route below is gated by `requireAdmin` and `verifyCsrf`, applied once
 * to the whole router so a new endpoint cannot be added unprotected by
 * accident. This is the one place Lob's refusals and Stripe's transfer
 * failures are shown in full, because this is the one person who can act on them.
 */
export const adminRouter: Router = Router();

adminRouter.use(requireAdmin, verifyCsrf, writeRateLimit);

function toHttp(error: unknown): never {
  if (error instanceof SlugTakenError) throw httpError(409, error.message);
  if (error instanceof StripeNotConfiguredError) throw httpError(503, error.message);
  if (error instanceof LobNotConfiguredError) throw httpError(503, error.message);
  const stripeError = classifyStripeError(error);
  if (stripeError) throw httpError(stripeError.status, stripeError.message);
  if (error instanceof ZodError) {
    const first = error.issues[0];
    throw httpError(400, first ? `${first.path.join(".")}: ${first.message}` : "Invalid input.");
  }
  throw error;
}

/* ------------------------------------------------------------- environment */

/** What is wired up on the server, as booleans. Never a value. */
adminRouter.get("/environment", (_req, res) => {
  res.json({
    hasStripeSecret: hasStripe,
    stripeMode: env.STRIPE_SECRET_KEY ? (env.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "live" : "test") : null,
    stripeKeyStatus: getStripeKeyCheck().status,
    hasWebhookSecret: Boolean(env.STRIPE_WEBHOOK_SECRET),
    hasEmail: Boolean(env.SMTP_URL),
    hasLob,
    lobMode,
    hasLobWebhook,
    database: isSqlite ? "sqlite" : "postgres",
    publicUrl: env.PUBLIC_URL,
    production: isProduction,
  } satisfies EnvironmentStatus);
});

/** Send one test email to the signed-in administrator, reporting the transport's own answer. */
adminRouter.post("/email/test", emailRateLimit, async (req, res) => {
  const admin = await findAdminById(req.session.adminId!);
  if (!admin) throw httpError(401, "Sign in again.");

  const settings = await getSettings();
  const storeName = settings?.name ?? "Yes I Want A Postcard";

  const result = await sendEmailReportingFailure(
    admin.email,
    `${storeName}: test email`,
    `<p>This is a test from the ${escapeHtml(storeName)} admin.</p>` +
      "<p>If you are reading it, welcome emails, postcard notices and password resets will reach their recipients too.</p>",
  );

  res.json(result satisfies EmailTestResult);
});

/** Send one test postcard to Lob's own test address, through the whole pipeline. */
adminRouter.post("/lob/test", emailRateLimit, async (_req, res) => {
  try {
    const card = await sendTestPostcard((await getSettings())?.name ?? "Yes I Want A Postcard");

    res.json({
      ok: true,
      message:
        card.mode === "live"
          ? `Lob accepted it as ${card.id}. This was a live key, so a real card is on its way to Lob's office.`
          : `Lob accepted it as ${card.id} in test mode. Nothing was printed.`,
      url: card.url,
    } satisfies LobTestResult);
  } catch (error) {
    if (error instanceof LobNotConfiguredError || error instanceof LobError) {
      res.json({ ok: false, message: error.message, url: null } satisfies LobTestResult);
      return;
    }
    throw error;
  }
});

/* ---------------------------------------------------------------- overview */

/** Everything the dashboard needs in one read: counts of every noun, what is waiting for review, and the last sweeps. */
adminRouter.get("/overview", async (_req, res) => {
  const [artists, purchases, editions, postcards, payouts, revenueCents, settings, pendingArtists] = await Promise.all([
    countArtistsByStatus(),
    countPurchasesByStatus(),
    countEditionsByStatus(),
    countPostcardsByStatus(),
    sumPayoutsByStatus(),
    sumRevenueCents(),
    getSettings(),
    listArtists({ reviewStatus: "pending", limit: 1 }),
  ]);
  res.json({
    artists,
    purchases,
    editions,
    review: { artists: pendingArtists.total, editions: editions.in_review ?? 0 },
    postcards,
    payouts,
    revenueCents,
    currency: settings?.currency ?? "USD",
    hasLob,
    lobMode,
    lastSweep: getLastSweep(),
    lastPayoutSweep: getLastPayoutSweep(),
  });
});

/** The old name, kept for the dashboard's fulfilment card. */
adminRouter.get("/fulfilment", async (_req, res) => {
  res.json({ postcards: await countPostcardsByStatus(), hasLob, lobMode, lastRun: getLastSweep() });
});

/** Run the print sweep now rather than waiting for the next tick. */
adminRouter.post("/fulfilment/run", async (_req, res) => {
  res.json(await sendDuePostcards());
});

adminRouter.post("/payouts/run", async (_req, res) => {
  res.json(await sendPendingPayouts());
});

/* ------------------------------------------------------------------- pages */

adminRouter.get("/pages", async (_req, res) => {
  res.json(await listPageDrafts());
});

adminRouter.post("/pages", async (req, res) => {
  try {
    const input = pageInputSchema.parse(req.body);
    res.status(201).json({ id: await createPage(input) });
  } catch (error) {
    toHttp(error);
  }
});

/** What a body will look like once it is published, rendered by the same sanitiser the site uses. */
adminRouter.post("/pages/preview", (req, res) => {
  const parsed = pagePreviewInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "A Markdown body is required.");

  res.json({ bodyHtml: renderMarkdown(parsed.data.body) });
});

// Registered before `/pages/:id`, so "reorder" and "preview" are never read as page ids.
adminRouter.post("/pages/reorder", async (req, res) => {
  let ids;
  try {
    ({ ids } = reorderInputSchema.parse(req.body));
  } catch (error) {
    toHttp(error);
  }
  await reorderPages(ids);
  res.status(204).end();
});

adminRouter.put("/pages/:id", async (req, res) => {
  if (!(await pageExists(req.params.id))) throw httpError(404, "Page not found.");

  try {
    const input = pageInputSchema.parse(req.body);
    await updatePage(req.params.id, input);
    res.status(204).end();
  } catch (error) {
    toHttp(error);
  }
});

adminRouter.delete("/pages/:id", async (req, res) => {
  if (!(await pageExists(req.params.id))) throw httpError(404, "Page not found.");

  await deletePage(req.params.id);
  res.status(204).end();
});

/* ---------------------------------------------------------------- settings */

adminRouter.get("/settings", async (_req, res) => {
  const settings = await getSettings();
  if (!settings) throw httpError(404, "Settings have not been created yet.");
  res.json(settings);
});

adminRouter.put("/settings", async (req, res) => {
  try {
    const input = settingsInputSchema.parse(req.body);

    // Before the write: a font URL that cannot be fetched is a typo, and the
    // operator has to be told while the field is still in front of them.
    await verifyFontUrl(input.theme.fontUrl);

    await updateSettings(input);

    // The CSP has to widen — or narrow — with the value that was just saved.
    await refreshFontOrigins();

    res.status(204).end();
  } catch (error) {
    toHttp(error);
  }
});

function imageUpload(owner: string) {
  return (req: Parameters<typeof uploadMiddleware>[0], res: Parameters<typeof uploadMiddleware>[1], next: Parameters<typeof uploadMiddleware>[2]) => {
    uploadMiddleware(req, res, (uploadError: unknown) => {
      void (async () => {
        try {
          if (uploadError) return next(mapUploadError(uploadError));
          if (!req.file) throw httpError(400, "No file was uploaded.");

          const { alt } = imageInputSchema.parse(req.body ?? {});
          const stored = await storeImage(owner, req.file.buffer);

          res.status(201).json({ ...stored, alt });
        } catch (error) {
          next(error);
        }
      })();
    });
  };
}

/** Stores a logo and hands the image back; it is persisted on Save with the rest of the theme. */
adminRouter.post("/settings/logo", imageUpload("store-logo"));
adminRouter.post("/settings/hero-image", imageUpload("store-hero"));

/* ----------------------------------------------------------------- artists */

adminRouter.get("/artists", async (req, res) => {
  const status = artistStatusSchema.safeParse(req.query.status);
  const [settings, page] = await Promise.all([getSettings(), listArtists({ ...(status.success ? { status: status.data } : {}), limit: 500 })]);
  const counts = await countForArtists(page.artists.map((a) => a.id));
  const currency = settings?.currency ?? "USD";
  res.json({
    artists: page.artists.map((artist) => ({
      ...toPublicArtist(artist, counts.get(artist.id), currency),
      payoutsEnabled: artist.payoutsEnabled,
      hasStripeAccount: artist.stripeAccountId !== null,
      customerId: artist.customerId,
      reviewStatus: artist.reviewStatus,
      reviewNote: artist.reviewNote,
    })),
    total: page.total,
  });
});

adminRouter.get("/artists/:id", async (req, res) => {
  const artist = await getArtist(req.params.id);
  if (!artist) throw httpError(404, "Artist not found.");
  const [settings, counts, editions, purchases] = await Promise.all([
    getSettings(),
    countForArtists([artist.id]),
    listEditionsForArtist(artist.id),
    listPurchasesForArtist(artist.id),
  ]);
  const currency = settings?.currency ?? "USD";
  res.json({
    artist: {
      ...toPublicArtist(artist, counts.get(artist.id), currency),
      bio: artist.bio,
      payoutsEnabled: artist.payoutsEnabled,
      stripeAccountId: artist.stripeAccountId,
      customerId: artist.customerId,
      reviewStatus: artist.reviewStatus,
      reviewNote: artist.reviewNote,
    },
    editions: await presentStudioEditions(editions, currency, artist.name),
    purchases: await presentAdminPurchases(purchases),
  });
});

/** Moderation: pause an artist, or put a paused one back. Draft is the artist's own to leave. */
adminRouter.post("/artists/:id/status", async (req, res) => {
  const parsed = z.object({ status: artistStatusSchema }).safeParse(req.body);
  if (!parsed.success) throw httpError(400, "Choose draft, live or paused.");
  if (!(await setArtistStatus(req.params.id, parsed.data.status))) throw httpError(404, "Artist not found.");
  res.status(204).end();
});

/* ------------------------------------------------------------------ review */

/** Tell the artist. Not awaited: the decision is on the row whether or not the mail goes. */
function tellArtist(artist: ArtistRecord, subject: Parameters<typeof sendReviewDecisionEmail>[1], decision: { approved: boolean; note: string | null }): void {
  void findCustomerById(artist.customerId)
    .then((customer) => (customer ? sendReviewDecisionEmail(customer.email, subject, decision) : false))
    .catch((error: unknown) => console.error("Could not tell the artist about a review:", error));
}

/**
 * The queue: pages the admin has not looked at, and editions their artists
 * sent, oldest first. Each edition comes with its artist, since an edition
 * can only be approved once its artist is.
 */
adminRouter.get("/review", async (_req, res) => {
  const [settings, pending, inReview] = await Promise.all([getSettings(), listArtists({ reviewStatus: "pending", limit: 500 }), listEditions({ status: "in_review", limit: 200 })]);
  const currency = settings?.currency ?? "USD";
  const artistIds = [...pending.artists.map((artist) => artist.id), ...inReview.editions.map((edition) => edition.artistId)];
  const [counts, editionArtists] = await Promise.all([countForArtists(artistIds), findArtistsByIds(inReview.editions.map((edition) => edition.artistId))]);
  const artistById = new Map(editionArtists.map((artist) => [artist.id, artist]));
  const presentArtist = (artist: ArtistRecord) => ({
    ...toPublicArtist(artist, counts.get(artist.id), currency),
    bio: artist.bio,
    customerId: artist.customerId,
    reviewStatus: artist.reviewStatus,
    reviewNote: artist.reviewNote,
  });
  const oldestFirst = [...inReview.editions].sort((a, b) => (a.submittedAt ?? a.createdAt) - (b.submittedAt ?? b.createdAt));
  const presented = await presentStudioEditions(oldestFirst, currency, "the artist");
  res.json({
    artists: pending.artists.map(presentArtist),
    editions: presented.map((edition, index) => {
      const artist = artistById.get(oldestFirst[index]!.artistId);
      return { ...edition, submittedAt: oldestFirst[index]!.submittedAt, artist: artist ? presentArtist(artist) : null };
    }),
  });
});

/** Yes or no to a page. Any time: a page can be declined after it was approved, and the artist told why. */
adminRouter.post("/artists/:id/review", async (req, res) => {
  const parsed = reviewInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "Choose approved or declined.");
  const artist = await getArtist(req.params.id);
  if (!artist) throw httpError(404, "Artist not found.");
  if (!(await reviewArtist(artist.id, parsed.data))) throw httpError(404, "Artist not found.");
  tellArtist(artist, { kind: "artist", artistName: artist.name, artistSlug: artist.slug }, { approved: parsed.data.decision === "approved", note: parsed.data.note || null });
  res.status(204).end();
});

/**
 * Yes or no to an edition in review. Approving puts it on sale, which is
 * the only way an edition gets there the first time; declining sends it
 * back to a draft with the note on it. An edition cannot be approved before
 * its artist is.
 */
adminRouter.post("/editions/:id/review", async (req, res) => {
  const parsed = reviewInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "Choose approved or declined.");
  const edition: EditionRecord | null = await getEdition(req.params.id);
  if (!edition) throw httpError(404, "Edition not found.");
  if (edition.status !== "in_review") throw httpError(409, "Only an edition in review can be approved or declined.");
  const artist = await getArtist(edition.artistId);
  if (!artist) throw httpError(404, "Artist not found.");
  if (parsed.data.decision === "approved" && artist.reviewStatus !== "approved") throw httpError(409, "Approve the artist's page before any of their editions.");
  if (!(await reviewEdition(edition.id, parsed.data))) throw httpError(409, "That edition has just been reviewed, or taken back by its artist.");
  tellArtist(
    artist,
    { kind: "edition", artistName: artist.name, artistSlug: artist.slug, title: edition.title, shape: `${edition.cardCount} cards` },
    { approved: parsed.data.decision === "approved", note: parsed.data.note || null },
  );
  res.status(204).end();
});

/* --------------------------------------------------------------- customers */

adminRouter.get("/customers", async (_req, res) => {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ id: schema.customers.id, email: schema.customers.email, name: schema.customers.name, emailVerifiedAt: schema.customers.emailVerifiedAt, createdAt: schema.customers.createdAt })
    .from(schema.customers)
    .orderBy(desc(schema.customers.createdAt))
    .limit(500)) as unknown as { id: string; email: string; name: string | null; emailVerifiedAt: unknown; createdAt: unknown }[];
  const { artists } = await listArtists({ limit: 500 });
  const slugByCustomer = new Map(artists.map((a) => [a.customerId, a.slug]));
  const { purchases } = await listPurchases({ status: "paid", limit: 200 });
  const paidByCustomer = new Map<string, number>();
  for (const p of purchases) paidByCustomer.set(p.customerId, (paidByCustomer.get(p.customerId) ?? 0) + 1);
  res.json(
    rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      emailVerified: row.emailVerifiedAt !== null && row.emailVerifiedAt !== undefined,
      createdAt: toEpochMs(row.createdAt),
      artistSlug: slugByCustomer.get(row.id) ?? null,
      purchases: paidByCustomer.get(row.id) ?? 0,
    })),
  );
});

/* --------------------------------------------------------------- purchases */

/** Collections as the admin sees them: the collector's own view, plus whose they are and the Stripe id to look up. */
async function presentAdminPurchases(purchases: PurchaseRecord[]) {
  const collections = await presentCollections(purchases);
  return collections.map((collection, index) => ({
    ...collection,
    customerId: purchases[index]!.customerId,
    stripePaymentIntentId: purchases[index]!.stripePaymentIntentId,
  }));
}

adminRouter.get("/purchases", async (req, res) => {
  const status = purchaseStatusSchema.safeParse(req.query.status);
  const page = await listPurchases({ ...(status.success ? { status: status.data } : {}), limit: Number(req.query.limit ?? 50), offset: Number(req.query.offset ?? 0) });
  res.json({ purchases: await presentAdminPurchases(page.purchases), total: page.total });
});

/* ---------------------------------------------------------------- editions */

adminRouter.get("/editions", async (req, res) => {
  const status = editionStatusSchema.safeParse(req.query.status);
  const [settings, page] = await Promise.all([
    getSettings(),
    listEditions({ ...(status.success ? { status: status.data } : {}), limit: Number(req.query.limit ?? 50), offset: Number(req.query.offset ?? 0) }),
  ]);
  const artists = await findArtistsByIds(page.editions.map((e) => e.artistId));
  const artistById = new Map(artists.map((a) => [a.id, a]));
  const currency = settings?.currency ?? "USD";
  const presented = await presentStudioEditions(page.editions, currency, "the artist");
  res.json({
    editions: presented.map((edition) => {
      const artist = artistById.get(edition.artistId);
      return { ...edition, artist: artist ? { id: artist.id, slug: artist.slug, name: artist.name } : null };
    }),
    total: page.total,
  });
});

/** One edition: its cards, who collected it, and every card of theirs with Lob's words on each failure. */
adminRouter.get("/editions/:id", async (req, res) => {
  const edition = await getEdition(req.params.id);
  if (!edition) throw httpError(404, "Edition not found.");
  const [settings, artist, purchases, postcards] = await Promise.all([
    getSettings(),
    getArtist(edition.artistId),
    listPurchasesForEdition(edition.id),
    listPostcardsForEdition(edition.id),
  ]);
  const [presented] = await presentStudioEditions([edition], settings?.currency ?? "USD", artist?.name ?? "the artist");
  res.json({
    edition: presented,
    artist: artist ? { id: artist.id, slug: artist.slug, name: artist.name } : null,
    purchases: await presentAdminPurchases(purchases),
    postcards,
  });
});

/** Cards Lob refused, across every edition: the "needs attention" list. */
adminRouter.get("/postcards/errors", async (_req, res) => {
  res.json(await listPostcardsByStatus("error"));
});

/** Put an errored card back on the schedule. The next sweep tries it again. */
adminRouter.post("/postcards/:id/retry", async (req, res) => {
  const postcard = await getPostcard(req.params.id);
  if (!postcard) throw httpError(404, "Postcard not found.");
  if (!(await requeuePostcard(postcard.id))) throw httpError(409, "Only a postcard that failed or was cancelled can be retried.");
  res.json({ postcard: await getPostcard(postcard.id) });
});

/** Withdraw one card that has not gone out. */
adminRouter.post("/postcards/:id/cancel", async (req, res) => {
  const postcard = await getPostcard(req.params.id);
  if (!postcard) throw httpError(404, "Postcard not found.");
  if (!(await cancelPostcard(postcard.id))) throw httpError(409, "That postcard has already gone to print, or was already cancelled.");
  res.json({ postcard: await getPostcard(postcard.id) });
});

/* ----------------------------------------------------------------- payouts */

adminRouter.get("/payouts", async (req, res) => {
  const status = payoutStatusSchema.safeParse(req.query.status);
  const page = await listPayouts({ ...(status.success ? { status: status.data } : {}), limit: Number(req.query.limit ?? 50), offset: Number(req.query.offset ?? 0) });
  const artists = await findArtistsByIds(page.payouts.map((p) => p.artistId));
  const artistById = new Map(artists.map((a) => [a.id, a]));
  res.json({
    payouts: page.payouts.map((p) => {
      const artist = artistById.get(p.artistId);
      return { ...toPayout(p), artist: artist ? { id: artist.id, slug: artist.slug, name: artist.name, payoutsEnabled: artist.payoutsEnabled } : null };
    }),
    total: page.total,
    totals: await sumPayoutsByStatus(),
  });
});

adminRouter.post("/payouts/:id/retry", async (req, res) => {
  if (!(await requeuePayout(req.params.id))) throw httpError(409, "Only a failed payout can be retried.");
  res.status(204).end();
});

/* ----------------------------------------------------------------- account */

/** Change your own password. Rate-limited with the login limiter: this verifies a password. */
adminRouter.put("/users/me/password", adminLoginRateLimit, async (req, res) => {
  let input;
  try {
    input = passwordChangeInputSchema.parse(req.body);
  } catch (error) {
    toHttp(error);
  }

  const id = req.session.adminId!;
  if (!(await verifyPasswordFor(id, input.current))) {
    throw httpError(401, "That is not your current password.");
  }

  await updateAdminPassword(id, input.next);

  // Every other session this account holds is signed out; only the one that
  // just proved it knows the old password survives.
  await destroySessionsForUser(id, { except: req.sessionID });

  res.status(204).end();
});
