import { readFileSync } from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import session from "express-session";
import { env, isProduction } from "./env.js";
import { DrizzleSessionStore } from "./session-store.js";
import { errorHandler, notFound, securityHeaders } from "./middleware.js";
import { publicRouter } from "./routes/public.js";
import { sessionRouter } from "./routes/session.js";
import { accountRouter } from "./routes/account.js";
import { studioRouter } from "./routes/studio.js";
import { setupRouter } from "./routes/setup.js";
import { adminRouter } from "./routes/admin.js";
import { checkoutRouter } from "./routes/checkout.js";
import { webhookRouter } from "./routes/webhook.js";
import { lobWebhookRouter } from "./routes/lob-webhook.js";
import { siteRouter } from "./routes/site.js";
import { injectMeta } from "./html.js";
import { metaForPath } from "./seo.js";
import { setAutoSweep, startFulfilmentScheduler } from "./fulfilment.js";
import { ASSETS_ROOT } from "./uploads.js";
import { imageStore, redirectToImageStore } from "./image-store.js";
import { refreshFontOrigins } from "./fonts.js";

export function createApp(options: { schedulers?: boolean } = {}): Express {
  const app = express();

  app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");
  app.use(securityHeaders);

  /*
   * The sweeps — mailings into cards, cards to Lob, shares to artists — run
   * on timers in this process. All unref'd, all safe to run on more than one
   * instance; see server/fulfilment.ts for the conditional updates that make
   * that true. Off under test, where a sweep firing mid-assertion is noise.
   */
  const schedulers = options.schedulers ?? env.NODE_ENV !== "test";
  setAutoSweep(schedulers);
  if (schedulers) startFulfilmentScheduler();

  // Widen the CSP to the platform's font before the first request, if it has one.
  void refreshFontOrigins();

  // Stripe and Lob sign the raw request body, so the webhooks are mounted
  // before any body parser rewrites it — and before sessions, which they do
  // not use.
  app.use("/api", webhookRouter);
  app.use("/api", lobWebhookRouter);

  app.use(
    session({
      name: "yiwap.sid",
      secret: env.SESSION_SECRET,
      store: new DrizzleSessionStore(),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: "/",
      },
    }),
  );

  // Bounded, so a large body cannot be used to exhaust memory. Image uploads
  // are multipart and go through multer's own limit.
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api", sessionRouter);
  app.use("/api", setupRouter);
  app.use(siteRouter);

  app.use("/api", publicRouter);
  app.use("/api/account", accountRouter);
  app.use("/api/studio", studioRouter);
  app.use("/api", checkoutRouter);
  app.use("/api/admin", adminRouter);

  /*
   * Uploaded imagery: the platform's own, every artist's avatar, and every
   * design's thumbnail and print file. Filenames are UUIDs.
   */
  app.use(
    "/assets",
    express.static(ASSETS_ROOT, {
      maxAge: isProduction ? "30d" : 0,
      index: false,
      dotfiles: "ignore",
    }),
  );

  if (imageStore.driver === "s3") {
    app.use("/assets", redirectToImageStore);
  }

  if (isProduction) {
    const dist = path.resolve("dist");
    // Read once: the built shell does not change while the server runs.
    const shell = readFileSync(path.join(dist, "index.html"), "utf8");

    app.use(express.static(dist, { index: false }));

    /*
     * SPA fallback for everything that is not an API route — with the page's
     * own metadata written into the head first, so a link unfurler sees a
     * title and an image rather than the generic shell.
     */
    app.get(/^(?!\/api\/).*/, async (req, res) => {
      const meta = await metaForPath(req.path);
      res.status(meta.status).type("html").send(injectMeta(shell, meta));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
