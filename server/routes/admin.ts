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
import { artistStatusSchema, mailingStatusSchema, payoutStatusSchema, subscriptionStatusSchema } from "../../shared/platform.js";
import { postcardBackSchema } from "../../shared/postcards.js";
import { SlugTakenError, updateSettings } from "../../db/admin-repository.js";
import { getSettings } from "../../db/repository.js";
import { createPage, deletePage, listPageDrafts, pageExists, reorderPages, updatePage } from "../../db/pages-repository.js";
import { countArtistsByStatus, countForArtists, findArtistsByIds, getArtist, listArtists, setArtistStatus } from "../../db/artists-repository.js";
import { findDesignsByIds } from "../../db/designs-repository.js";
import { countMailingsByStatus, countPostcardsByMailing, getMailing, listMailings, listMailingsForArtist } from "../../db/mailings-repository.js";
import { cancelPostcard, countPostcardsByStatus, getPostcard, listPostcardsByStatus, listPostcardsForMailing, requeuePostcard } from "../../db/postcards-repository.js";
import { countSubscriptionsByStatus, listSubscriptions, listSubscriptionsForArtist } from "../../db/subscriptions-repository.js";
import { countPaidMonthsForSubscriptions, listOrders, sumRevenueCents } from "../../db/orders-repository.js";
import { listPayouts, requeuePayout, sumPayoutsByStatus } from "../../db/payouts-repository.js";
import { getDatabase } from "../../db/client.js";
import { refreshFontOrigins, verifyFontUrl } from "../fonts.js";
import { adminLoginRateLimit, emailRateLimit, httpError, requireAdmin, verifyCsrf, writeRateLimit } from "../middleware.js";
import { env, hasLob, hasLobWebhook, hasStripe, isProduction, isSqlite, lobMode } from "../env.js";
import { mapUploadError, storeImage, uploadMiddleware } from "../uploads.js";
import { StripeNotConfiguredError, classifyStripeError, getStripeKeyCheck } from "../stripe.js";
import { renderMarkdown } from "../markdown.js";
import { escapeHtml } from "../html.js";
import { sendEmailReportingFailure } from "../email.js";
import { LobError, LobNotConfiguredError, sendTestPostcard } from "../lob.js";
import { getLastPayoutSweep, getLastSweep, sendDueMailings, sendDuePostcards, sendPendingPayouts } from "../fulfilment.js";
import { toMailing, toOrder, toPayout, toPublicArtist, toSubscription } from "../presenters.js";
import { destroySessionsForUser, findAdminById, updateAdminPassword, verifyPasswordFor } from "../auth.js";
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
adminRouter.post("/lob/test", emailRateLimit, async (req, res) => {
  const back = postcardBackSchema.safeParse(req.body ?? {});

  try {
    const card = await sendTestPostcard(
      back.success ? back.data : postcardBackSchema.parse({ text: "This is a test postcard from the admin.", valediction: "— the printer check" }),
    );

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

/** Everything the dashboard needs in one read: counts of every noun, and the last sweeps. */
adminRouter.get("/overview", async (_req, res) => {
  const [artists, subscriptions, mailings, postcards, payouts, revenueCents, settings] = await Promise.all([
    countArtistsByStatus(),
    countSubscriptionsByStatus(),
    countMailingsByStatus(),
    countPostcardsByStatus(),
    sumPayoutsByStatus(),
    sumRevenueCents(),
    getSettings(),
  ]);
  res.json({
    artists,
    subscriptions,
    mailings,
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

/** Run the sweeps now rather than waiting for the next tick. */
adminRouter.post("/fulfilment/run", async (_req, res) => {
  const mailings = await sendDueMailings();
  const postcards = await sendDuePostcards();
  res.json({ ...postcards, mailings });
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
    })),
    total: page.total,
  });
});

adminRouter.get("/artists/:id", async (req, res) => {
  const artist = await getArtist(req.params.id);
  if (!artist) throw httpError(404, "Artist not found.");
  const [settings, counts, mailings, subscriptions] = await Promise.all([
    getSettings(),
    countForArtists([artist.id]),
    listMailingsForArtist(artist.id),
    listSubscriptionsForArtist(artist.id),
  ]);
  const currency = settings?.currency ?? "USD";
  const [designs, mailingCounts, paidMonths] = await Promise.all([
    findDesignsByIds(mailings.map((m) => m.designId)),
    countPostcardsByMailing(mailings.map((m) => m.id)),
    countPaidMonthsForSubscriptions(subscriptions.map((s) => s.id)),
  ]);
  const designById = new Map(designs.map((d) => [d.id, d]));
  res.json({
    artist: { ...toPublicArtist(artist, counts.get(artist.id), currency), bio: artist.bio, payoutsEnabled: artist.payoutsEnabled, stripeAccountId: artist.stripeAccountId, customerId: artist.customerId },
    mailings: mailings.flatMap((m) => {
      const design = designById.get(m.designId);
      return design ? [toMailing(m, design, mailingCounts.get(m.id), artist.name)] : [];
    }),
    subscriptions: subscriptions.map((s) => toSubscription(s, artist, 0, paidMonths.get(s.id) ?? 0)),
  });
});

/** Moderation: pause an artist, or put a paused one back. Draft is the artist's own to leave. */
adminRouter.post("/artists/:id/status", async (req, res) => {
  const parsed = z.object({ status: artistStatusSchema }).safeParse(req.body);
  if (!parsed.success) throw httpError(400, "Choose draft, live or paused.");
  if (!(await setArtistStatus(req.params.id, parsed.data.status))) throw httpError(404, "Artist not found.");
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
  const { subscriptions } = await listSubscriptions({ status: "active", limit: 200 });
  const activeByCustomer = new Map<string, number>();
  for (const s of subscriptions) activeByCustomer.set(s.customerId, (activeByCustomer.get(s.customerId) ?? 0) + 1);
  res.json(
    rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      emailVerified: row.emailVerifiedAt !== null && row.emailVerifiedAt !== undefined,
      createdAt: toEpochMs(row.createdAt),
      artistSlug: slugByCustomer.get(row.id) ?? null,
      activeSubscriptions: activeByCustomer.get(row.id) ?? 0,
    })),
  );
});

/* ----------------------------------------------------------- subscriptions */

adminRouter.get("/subscriptions", async (req, res) => {
  const status = subscriptionStatusSchema.safeParse(req.query.status);
  const page = await listSubscriptions({ ...(status.success ? { status: status.data } : {}), limit: Number(req.query.limit ?? 50), offset: Number(req.query.offset ?? 0) });
  const artists = await findArtistsByIds(page.subscriptions.map((s) => s.artistId));
  const artistById = new Map(artists.map((a) => [a.id, a]));
  res.json({ subscriptions: page.subscriptions.map((s) => ({ ...toSubscription(s, artistById.get(s.artistId), 0), customerId: s.customerId })), total: page.total });
});

/* ---------------------------------------------------------------- mailings */

adminRouter.get("/mailings", async (req, res) => {
  const status = mailingStatusSchema.safeParse(req.query.status);
  const page = await listMailings({ ...(status.success ? { status: status.data } : {}), limit: Number(req.query.limit ?? 50), offset: Number(req.query.offset ?? 0) });
  const [designs, artists, counts] = await Promise.all([
    findDesignsByIds(page.mailings.map((m) => m.designId)),
    findArtistsByIds(page.mailings.map((m) => m.artistId)),
    countPostcardsByMailing(page.mailings.map((m) => m.id)),
  ]);
  const designById = new Map(designs.map((d) => [d.id, d]));
  const artistById = new Map(artists.map((a) => [a.id, a]));
  res.json({
    mailings: page.mailings.flatMap((m) => {
      const design = designById.get(m.designId);
      const artist = artistById.get(m.artistId);
      return design ? [{ ...toMailing(m, design, counts.get(m.id), artist?.name), artist: artist ? { id: artist.id, slug: artist.slug, name: artist.name } : null }] : [];
    }),
    total: page.total,
  });
});

/** One mailing, card by card, with Lob's words on each failure. */
adminRouter.get("/mailings/:id", async (req, res) => {
  const mailing = await getMailing(req.params.id);
  if (!mailing) throw httpError(404, "Mailing not found.");
  const [designs, artist, counts, cards] = await Promise.all([
    findDesignsByIds([mailing.designId]),
    getArtist(mailing.artistId),
    countPostcardsByMailing([mailing.id]),
    listPostcardsForMailing(mailing.id),
  ]);
  const design = designs[0];
  if (!design) throw httpError(404, "The mailing's design is gone.");
  res.json({
    mailing: toMailing(mailing, design, counts.get(mailing.id), artist?.name),
    artist: artist ? { id: artist.id, slug: artist.slug, name: artist.name } : null,
    postcards: cards,
  });
});

/** Cards Lob refused, across every mailing: the "needs attention" list. */
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

/* ------------------------------------------------------------------ orders */

/** Every paid invoice, newest first. */
adminRouter.get("/orders", async (req, res) => {
  const page = await listOrders({ limit: Number(req.query.limit ?? 50), offset: Number(req.query.offset ?? 0) });
  const artists = await findArtistsByIds(page.orders.map((o) => o.artistId));
  const artistById = new Map(artists.map((a) => [a.id, a]));
  res.json({ orders: page.orders.map((o) => ({ ...toOrder(o, artistById.get(o.artistId)), customerId: o.customerId })), total: page.total });
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
