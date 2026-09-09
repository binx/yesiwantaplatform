import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { isProduction } from "./env.js";
import { safeEqual } from "./auth.js";

declare module "express-session" {
  interface SessionData {
    adminId?: string;
    /**
     * A signed-in storefront customer — deliberately a different flag from
     * `adminId`. `requireAdmin` only ever reads `adminId`, so a customer
     * session is refused there exactly like an anonymous one; see
     * `requireCustomer` below for the mirror image.
     */
    customerId?: string;
    csrfToken?: string;
  }
}

/**
 * Content Security Policy.
 *
 * Stripe.js must be loadable and framed for 3-D Secure; everything else is
 * same-origin. v1 used helmet 3's defaults, which set no CSP at all.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://js.stripe.com"],
      frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      // antd injects component styles at runtime.
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  // Product images are served to the storefront, which may sit behind a CDN.
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
});

/**
 * Login rate limit.
 *
 * v1 used `max: 1` per 15 seconds, which locked out a user who mistyped their
 * password once while barely inconveniencing an attacker. This allows a normal
 * retry pattern and still caps sustained guessing.
 */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many sign-in attempts. Try again in a few minutes." },
});

/**
 * Routes that send an email to an address the caller chose.
 *
 * `loginRateLimit` skips successful responses, which is right for a login and
 * wrong here: registration and a password-reset request answer 204 whether or
 * not the address exists — that is the enumeration defence — so under the
 * login limiter neither ever counted, and one loop could push unlimited mail
 * at any inbox through the merchant's own SMTP reputation. Every response
 * counts here, and the ceiling is what a person retrying a form needs, not
 * what a script does.
 */
export const emailRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Try again in a few minutes." },
});

/** A broad ceiling on write traffic, so a loop cannot hammer the database. */
export const writeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

/**
 * Reject anonymous callers.
 *
 * In v1 the mutating routes had no check at all, and `/user` plus
 * `/list-orders` granted admin to everyone whenever NODE_ENV was not
 * "production" — which is the default. There is no environment-based bypass
 * here; a session is the only way in.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.adminId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  next();
}

/**
 * Reject anyone who is not a signed-in customer.
 *
 * Reads `customerId` only — never `adminId` — so an administrator's session
 * does not incidentally satisfy this, and a customer's session cannot
 * satisfy `requireAdmin` above. The two are different flags on purpose.
 */
export function requireCustomer(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.customerId) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  next();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Issue a per-session CSRF token, created on first use. */
export function csrfToken(req: Request): string {
  req.session.csrfToken ??= randomBytes(32).toString("base64url");
  return req.session.csrfToken;
}

/**
 * Synchronizer-token CSRF check on every state-changing request.
 *
 * The token is bound to the session rather than mirrored from a cookie, so a
 * subdomain that can write cookies still cannot forge a request. Combined with
 * SameSite=Lax this is belt and braces, which is the right posture for a
 * server that can delete a store's catalogue.
 */
export function verifyCsrf(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();

  const expected = req.session.csrfToken;
  const provided = req.get("x-csrf-token");

  if (!expected || !provided || !safeEqual(expected, provided)) {
    res.status(403).json({ error: "Invalid or missing CSRF token." });
    return;
  }

  next();
}

/**
 * express-session's callbacks pass `any`; normalise to a real Error.
 *
 * Shared by the admin session route and the customer account route — both
 * regenerate the session on sign-in for the same session-fixation reason.
 */
export function sessionOp(run: (done: (error?: unknown) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    run((error) => {
      if (!error) return resolve();
      reject(error instanceof Error ? error : new Error("Session operation failed."));
    });
  });
}

export interface ApiError extends Error {
  status?: number;
  expose?: boolean;
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found." });
}

/**
 * Terminal error handler.
 *
 * Only messages explicitly marked `expose` reach the client; everything else
 * becomes a generic 500 so stack traces and driver errors are not leaked.
 */
export function errorHandler(
  error: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = error.status ?? 500;

  if (status >= 500) console.error(error);

  res.status(status).json({
    error: error.expose || status < 500 ? error.message : "Something went wrong.",
  });
}

export function httpError(status: number, message: string): ApiError {
  const error = new Error(message) as ApiError;
  error.status = status;
  error.expose = true;
  return error;
}
