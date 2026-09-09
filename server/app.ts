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
import { setupRouter } from "./routes/setup.js";
import { storefrontRouter } from "./routes/storefront.js";
import { adminRouter } from "./routes/admin.js";
import { checkoutRouter } from "./routes/checkout.js";
import { shippingRouter } from "./routes/shipping.js";
import { cartRouter } from "./routes/cart.js";
import { webhookRouter } from "./routes/webhook.js";
import { siteRouter } from "./routes/site.js";
import { requireStorefrontAccess } from "./storefront-gate.js";
import { injectMeta } from "./html.js";
import { metaForPath, type ResolvedMeta } from "./seo.js";
import { startCartRecoveryScheduler } from "./cart-recovery.js";
import { startWebhookDispatcher } from "./webhooks.js";
import { ASSETS_ROOT } from "./uploads.js";
import { imageStore, redirectToImageStore } from "./image-store.js";
import { refreshFontOrigins } from "./fonts.js";

export function createApp(): Express {
  const app = express();

  // Needed for `secure` cookies and correct client IPs behind a proxy or a
  // platform load balancer. One hop in production unless TRUST_PROXY says
  // otherwise — see server/env.ts for why "every hop" is never the default.
  app.set("trust proxy", env.TRUST_PROXY);

  app.disable("x-powered-by");
  app.use(securityHeaders);

  // Same shape as the session store's prune timer just below: a `setInterval`
  // in this process, unref'd so it never holds the process open. See
  // server/cart-recovery.ts for why running it per-instance is safe.
  startCartRecoveryScheduler();

  // Outbound webhook delivery, on the interval task 12 established rather than
  // a second scheduling mechanism — see server/webhooks.ts. This is what keeps
  // sending out of the Stripe webhook's request path.
  startWebhookDispatcher();

  /*
   * Widen the CSP to the store's font before the first request, if it has one.
   *
   * Not awaited, because `createApp` is synchronous and a font is not worth
   * delaying the listen for. The cost of losing that race is one page served
   * with the pre-font policy — the face falls back for that load and is right
   * on the next. `refreshFontOrigins` never rejects; see server/fonts.ts.
   */
  void refreshFontOrigins();

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

  // Everything above this line is exempt from the storefront gate below by
  // being mounted ahead of it: the webhook (already exempt, before sessions),
  // the health check, and the admin sign-in and setup wizard APIs.
  app.use("/api", sessionRouter);
  app.use("/api", setupRouter);
  app.use("/api", storefrontRouter);

  // sitemap.xml and robots.txt live at the root, not under /api. Also exempt:
  // a crawler that already has a locked store's URL should be told to leave,
  // not given a 401 it will retry — see server/routes/site.ts.
  app.use(siteRouter);

  let dist: string | undefined;
  let shell: string | undefined;

  if (isProduction) {
    dist = path.resolve("dist");
    // Read once: the built shell does not change while the server runs.
    shell = readFileSync(path.join(dist, "index.html"), "utf8");

    // The compiled client bundle. Exempt because the gate is rendered *by*
    // this bundle — the SPA has to be downloadable before it can show anyone
    // a password form.
    app.use(express.static(dist, { index: false }));
  }

  /*
   * The storefront password gate — see docs/tasks/27-storefront-preview-mode.md.
   *
   * Position, not an allow-list, decides what this covers: everything above
   * is exempt by being mounted first, and everything below is gated by
   * position — an allow-list fails open for the next route someone adds below
   * it, and this fails closed instead.
   */
  app.use(requireStorefrontAccess);

  app.use("/api", publicRouter);
  app.use("/api/account", accountRouter);
  app.use("/api", checkoutRouter);
  app.use("/api", shippingRouter);
  app.use("/api/cart", cartRouter);
  app.use("/api/admin", adminRouter);

  // Uploaded product imagery. Gated: a locked store's catalogue photos are
  // part of what is locked, even though the filenames are unguessable UUIDs
  // and this is defence in depth rather than the protection itself.
  app.use(
    "/assets",
    express.static(ASSETS_ROOT, {
      maxAge: isProduction ? "30d" : 0,
      // Never execute anything out of the upload directory.
      index: false,
      dotfiles: "ignore",
    }),
  );

  // Under the bucket driver, whatever is not on disk is in the bucket: the
  // URL contract stays `/assets/<path>` and this answers it with a redirect.
  // Behind the static handler, so the bundled demo images are served as
  // before; behind the gate, for the same reason the static handler is.
  if (imageStore.driver === "s3") {
    app.use("/assets", redirectToImageStore);
  }

  if (isProduction && dist && shell) {
    const builtShell = shell;

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
      // A locked store must not hand a crawler or a link unfurler the product
      // name, price, image and JSON-LD that `metaForPath` would otherwise put
      // in an anonymous `GET /product/anything` — without ever rendering the
      // page itself. `metaForPath` is skipped entirely rather than trusted to
      // omit the sensitive parts; the generic head carries nothing to omit.
      // `storefrontLocked` is set by `requireStorefrontAccess`, above, on this
      // same request — recomputing it here could disagree with the gate.
      const meta = res.locals.storefrontLocked ? genericLockedMeta() : await metaForPath(req.path);

      // The body is the shell either way — React boots and renders its own
      // not-found page — but the status has to be the truth, or a crawler
      // indexes a product that does not exist as a live page.
      res.status(meta.status).type("html").send(injectMeta(builtShell, meta));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

/** No title beyond a neutral one, no description, no image, no JSON-LD. */
function genericLockedMeta(): ResolvedMeta {
  return {
    title: "This store is not open yet",
    description: "",
    canonical: env.PUBLIC_URL,
    image: null,
    jsonLd: null,
    fontUrl: null,
    lang: "en",
    status: 200,
  };
}
