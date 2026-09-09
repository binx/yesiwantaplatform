import { randomBytes } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import {
  setupInputSchema,
  type SetupStatus,
  type SessionResponse,
} from "../../shared/api.js";
import { DEFAULT_TAX_CODE } from "../../shared/schema.js";
import { countAdmins, createAdmin, safeEqual } from "../auth.js";
import { getSettings, isConfigured } from "../../db/repository.js";
import { updateSettings } from "../../db/admin-repository.js";
import { seedIfEmpty } from "../../db/seed.js";
import { env, hasStripe, isProduction } from "../env.js";
import { csrfToken, httpError, verifyCsrf } from "../middleware.js";

/**
 * First-run setup.
 *
 * v1's first run was: clone, `npm run server`, uncaught ENOENT on a missing
 * `config.env`, hand-author an undocumented secrets file, restart, then find a
 * two-field modal. The server here boots unconfigured on purpose and offers
 * this route until a store exists.
 *
 * The whole router is self-closing: once `isConfigured()` is true it answers
 * 410 and nothing below it can run again. That matters, because `POST /setup`
 * necessarily creates an administrator without being authenticated — it is
 * safe only for as long as there is no administrator to impersonate.
 */
export const setupRouter: Router = Router();

/** Generous enough for a mistyped password, tight enough to not be a hammer. */
const setupRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many setup attempts. Try again in a few minutes." },
});

/**
 * The secret the wizard has to know before `POST /setup` will do anything.
 *
 * "Self-closing once configured" protects a store that exists. It does nothing
 * for the minutes between a first deploy and the owner reaching the wizard —
 * and a fresh public address is port-scanned within minutes, so on a PaaS
 * that window is a real race. A token that only ever appears in the server's
 * own log (or in its environment) closes it: whoever can read the log is the
 * operator.
 *
 * `null` in development and test, where the process is bound to a machine
 * nobody else can reach and a token would only be friction. Setting
 * SETUP_TOKEN explicitly makes it required everywhere, which is also how it is
 * tested.
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

/**
 * Setup state.
 *
 * Public by necessity: a visitor to an unconfigured store has to be told that
 * it is unconfigured. The detail fields therefore disappear the moment setup
 * completes, so a live store reveals nothing about its own wiring here.
 */
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
    requiresToken: activeSetupToken() !== null,
  } satisfies SetupStatus);
});

/**
 * Serialise setup so two concurrent submissions cannot both pass the
 * `isConfigured` check and create two administrators. The re-check inside the
 * lock is the one that counts.
 */
let inFlight: Promise<unknown> = Promise.resolve();

function serialise<T>(run: () => Promise<T>): Promise<T> {
  const next = inFlight.then(run, run);
  // Keep the chain alive even when a caller rejects.
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

  // Checked before the lock: a caller without the token should not get to
  // touch the serialised section at all, let alone learn its state.
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

    // Demo data first: it writes a settings row from the fixture, which the
    // owner's own values then overwrite. Skipping it leaves `updateSettings`
    // to create that row itself.
    if (input.seedDemo) await seedIfEmpty();

    await updateSettings({
      name: input.storeName,
      currency: input.currency.toUpperCase(),
      stripePublishableKey: input.stripePublishableKey,
      aboutText: null,
      // Off until the merchant activates Stripe Tax and registers. The wizard
      // says so; Settings is where it is turned on.
      taxEnabled: false,
      taxBehavior: "exclusive",
      defaultTaxCode: DEFAULT_TAX_CODE,
      // Off until the merchant opts in from Settings — see the Settings copy.
      cartRecoveryEnabled: false,
      cartRecoveryDelayHours: 4,
      theme: input.theme,
    });

    // An account may already exist from `npm run setup` or a seeded
    // ADMIN_PASSWORD; adding a second one from an unauthenticated route would
    // be a backdoor, so the store is finished without one.
    if ((await countAdmins()) > 0) return null;

    return createAdmin(input.email, input.password);
  });

  // Sign the new owner in directly, so setup does not end at a login form.
  if (adminId) {
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error: unknown) => (error ? reject(toError(error)) : resolve()));
    });

    req.session.adminId = adminId;
    // Issued before the save, so the token the client is about to use is the
    // one actually persisted against the regenerated session.
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
