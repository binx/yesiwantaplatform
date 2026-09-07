import path from "node:path";
import express, { type Express } from "express";
import session from "express-session";
import { env, isProduction } from "./env.js";
import { DrizzleSessionStore } from "./session-store.js";
import { errorHandler, notFound, securityHeaders } from "./middleware.js";
import { publicRouter } from "./routes/public.js";
import { sessionRouter } from "./routes/session.js";
import { adminRouter } from "./routes/admin.js";

export function createApp(): Express {
  const app = express();

  // Needed for `secure` cookies and correct client IPs behind a proxy or a
  // platform load balancer.
  if (isProduction) app.set("trust proxy", 1);

  app.disable("x-powered-by");
  app.use(securityHeaders);

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
  app.use("/api", publicRouter);
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
    app.use(express.static(dist, { index: false }));

    // SPA fallback for everything that is not an API route.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(dist, "index.html"));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
