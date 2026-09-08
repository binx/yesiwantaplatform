import { readFileSync } from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import session from "express-session";
import { env, isProduction } from "./env.js";
import { DrizzleSessionStore } from "./session-store.js";
import { errorHandler, notFound, securityHeaders } from "./middleware.js";
import { publicRouter } from "./routes/public.js";
import { sessionRouter } from "./routes/session.js";
import { setupRouter } from "./routes/setup.js";
import { adminRouter } from "./routes/admin.js";
import { checkoutRouter } from "./routes/checkout.js";
import { shippingRouter } from "./routes/shipping.js";
import { webhookRouter } from "./routes/webhook.js";
import { siteRouter } from "./routes/site.js";
import { injectMeta } from "./html.js";
import { metaForPath } from "./seo.js";

export function createApp(): Express {
  const app = express();

  // Needed for `secure` cookies and correct client IPs behind a proxy or a
  // platform load balancer.
  if (isProduction) app.set("trust proxy", 1);

  app.disable("x-powered-by");
  app.use(securityHeaders);

  // Stripe signs the raw request body, so the webhook must be mounted before
  // any body parser rewrites it — and before sessions, which it does not use.
  app.use("/api", webhookRouter);

  app.use(
    session({
      name: "beluga.sid",
      secret: env.SESSION_SECRET,
      store: new DrizzleSessionStore(),
      resave: false,
      // v1 used `saveUninitialized: true`, writing a session row for every
      // anonymous visitor.
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        maxAge: 24 * 60 * 60 * 1000,
        path: "/",
      },
    }),
  );

  // Bounded, so a large body cannot be used to exhaust memory. The Stripe
  // webhook in Phase 3 mounts its own raw-body parser before this.
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api", sessionRouter);
  app.use("/api", setupRouter);
  app.use("/api", publicRouter);

  // sitemap.xml and robots.txt live at the root, not under /api, and must be
  // mounted before the SPA fallback below — its regex matches everything that
  // is not /api, this pair included.
  app.use(siteRouter);
  app.use("/api", checkoutRouter);
  app.use("/api", shippingRouter);
  app.use("/api/admin", adminRouter);

  // Uploaded product imagery.
  app.use(
    "/assets",
    express.static(path.resolve("public/assets"), {
      maxAge: isProduction ? "30d" : 0,
      // Never execute anything out of the upload directory.
      index: false,
      dotfiles: "ignore",
    }),
  );

  if (isProduction) {
    const dist = path.resolve("dist");

    // Read once: the built shell does not change while the server runs.
    const shell = readFileSync(path.join(dist, "index.html"), "utf8");

    // Static first, so a real asset request never reaches the injector below.
    app.use(express.static(dist, { index: false }));

    /*
     * SPA fallback for everything that is not an API route — but with the
     * page's own metadata written into the head first.
     *
     * The storefront is client-rendered, so without this a crawler or a link
     * unfurler fetching /product/anything gets the generic shell: no product
     * name, no price, no image, every shared link previewing identically. This
     * is not SSR — only <head> is rewritten, and React still boots and renders
     * the body exactly as before.
     */
    app.get(/^(?!\/api\/).*/, async (req, res) => {
      const meta = await metaForPath(req.path);
      res.type("html").send(injectMeta(shell, meta));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
