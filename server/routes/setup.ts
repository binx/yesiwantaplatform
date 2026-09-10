import { randomBytes } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import { setupInputSchema, type SetupStatus, type SessionResponse } from "../../shared/api.js";
import { defaultHero } from "../../shared/schema.js";
import { countAdmins, createAdmin, safeEqual } from "../auth.js";
import { getSettings, isConfigured } from "../../db/repository.js";
import { updateSettings } from "../../db/admin-repository.js";
import { refreshFontOrigins, verifyFontUrl } from "../fonts.js";
import { env, hasStripe, isProduction } from "../env.js";
import { csrfToken, httpError, verifyCsrf } from "../middleware.js";
import { getStripeKeyCheck } from "../stripe.js";

/**
 * First-run setup.
 *
 * The server boots unconfigured on purpose and offers this route until a
 * store exists. The whole router is self-closing: once `isConfigured()` is
 * true it answers 410 and nothing below it can run again.
 */
export const setupRouter: Router = Router();

const setupRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many setup attempts. Try again in a few minutes." },
});

/**
 * The secret the wizard has to know before `POST /setup` will do anything, in
 * production. Printed in the server's log and nowhere else, so whoever can
 * read the log is the operator. `null` in development and test.
 */
let generatedToken: string | null = null;

export function activeSetupToken(): string | null {
  if (env.SETUP_TOKEN) return env.SETUP_TOKEN;
  if (!isProduction) return null;
  generatedToken ??= randomBytes(24).toString("base64url");
  return generatedToken;
}

function stripeMode(): "test" | "live" | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  return env.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "live" : "test";
}

setupRouter.get("/setup", async (_req, res) => {
  if (await isConfigured()) {
    res.json({ needsSetup: false } satisfies SetupStatus);
    return;
  }

  const [admins, settings] = await Promise.all([countAdmins(), getSettings()]);

  res.json({
    needsSetup: true,
    hasAdmin: admins > 0,
    hasSettings: settings !== null,
    hasStripeSecret: hasStripe,
    stripeMode: stripeMode(),
    stripeKeyStatus: getStripeKeyCheck().status,
    requiresToken: activeSetupToken() !== null,
    publicUrl: env.PUBLIC_URL,
  } satisfies SetupStatus);
});

/** Serialise setup so two concurrent submissions cannot both create an administrator. */
let inFlight: Promise<unknown> = Promise.resolve();

function serialise<T>(run: () => Promise<T>): Promise<T> {
  const next = inFlight.then(run, run);
  inFlight = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

setupRouter.post("/setup", setupRateLimit, verifyCsrf, async (req, res) => {
  let input;
  try {
    input = setupInputSchema.parse(req.body);
  } catch (error) {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      throw httpError(400, first ? `${first.path.join(".")}: ${first.message}` : "Invalid input.");
    }
    throw error;
  }

  const required = activeSetupToken();
  if (required && !(input.setupToken && safeEqual(input.setupToken, required))) {
    throw httpError(
      403,
      "The setup token is missing or wrong. The server printed it when it started, or it is the SETUP_TOKEN in its environment.",
    );
  }

  const adminId = await serialise(async () => {
    if (await isConfigured()) {
      throw httpError(410, "This store is already set up. Sign in instead.");
    }

    await verifyFontUrl(input.theme.fontUrl);

    const existing = await getSettings();

    await updateSettings({
      name: input.storeName,
      currency: input.currency.toUpperCase(),
      locale: "en-US",
      stripePublishableKey: input.stripePublishableKey,
      // v1's price, and the one on the landing page copy. Settings is where
      // it changes.
      postcardPriceCents: existing?.postcardPriceCents ?? 140,
      cartRecoveryEnabled: false,
      cartRecoveryDelayHours: 4,
      hero: defaultHero,
      theme: input.theme,
    });

    await refreshFontOrigins();

    // An account may already exist from `npm run setup` or a seeded
    // ADMIN_PASSWORD; adding a second one from an unauthenticated route would
    // be a backdoor, so the store is finished without one.
    if ((await countAdmins()) > 0) return null;

    return createAdmin(input.email, input.password);
  });

  if (adminId) {
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error: unknown) => (error ? reject(toError(error)) : resolve()));
    });

    req.session.adminId = adminId;
    csrfToken(req);

    await new Promise<void>((resolve, reject) => {
      req.session.save((error: unknown) => (error ? reject(toError(error)) : resolve()));
    });
  }

  res.status(201).json({
    isAdmin: Boolean(adminId),
    csrfToken: csrfToken(req),
    isConfigured: true,
  } satisfies SessionResponse);
});

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error("Session operation failed.");
}
