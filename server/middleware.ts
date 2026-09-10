import { randomBytes } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { objectStorage } from "./env.js";
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
 * The origins the store's web font is served from, if it has one.
 *
 * The value lives here rather than in `server/fonts.ts` — which is what
 * resolves it — so the dependency runs one way: everything imports this
 * module, and a module this one imported back would be a cycle. `fonts.ts`
 * pushes; the header below reads.
 *
 * Empty is the default and the common case, and it is what keeps a store that
 * has set no font URL on byte-for-byte the header it had before fonts existed.
 */
let fontOrigins: readonly string[] = [];

/** Told by `refreshFontOrigins`. See server/fonts.ts. */
export function setCspFontOrigins(origins: readonly string[]): void {
  fontOrigins = origins;
}

/**
 * Where images may come from besides `'self'`.
 *
 * Under the bucket driver `/assets/<path>` answers with a redirect, and a CSP
 * is checked against every hop of a redirect, not only the first — so the
 * bucket's origin has to be listed or every product image is blocked, with a
 * console error and no request in the network log to explain it. Derived
 * from ASSETS_PUBLIC_URL once at boot, the same way `fonts.ts` derives a
 * font origin; empty under the local driver, which keeps that header
 * byte-for-byte what it was.
 */
const imageOrigins: readonly string[] = objectStorage ? [new URL(objectStorage.publicUrl).origin] : [];

/**
 * Content Security Policy.
 *
 * Stripe.js must be loadable and framed for 3-D Secure; everything else is
 * same-origin. v1 used helmet 3's defaults, which set no CSP at all.
 *
 * `styleSrc` and `fontSrc` are the one part that is not fixed: a theme may
 * name a font stylesheet, and the browser has to be allowed to fetch both it
 * and the faces it points at. Nothing is hardcoded per provider — the origins
 * come from the stylesheet the merchant actually chose, resolved once by
 * `server/fonts.ts`, which is why a self-hosted font works exactly as well as
 * Google's.
 */
function policyFor(extraOrigins: readonly string[]) {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://js.stripe.com"],
        frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
        connectSrc: ["'self'", "https://api.stripe.com"],
        imgSrc: ["'self'", "data:", "blob:", ...imageOrigins],
        // antd injects component styles at runtime.
        styleSrc: ["'self'", "'unsafe-inline'", ...extraOrigins],
        fontSrc: ["'self'", "data:", ...extraOrigins],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        // Helmet sends this directive by default regardless of environment —
        // there was never a conditional here that worked, only one that read
        // as if it did. A self-hosted store on plain HTTP behind nothing is
        // unsupported: every request would be upgraded to an https:// origin
        // that does not answer.
        upgradeInsecureRequests: [],
      },
    },
    // Product images are served to the storefront, which may sit behind a CDN.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
}

/**
 * One helmet instance per distinct origin set.
 *
 * Building the policy is not free and the answer changes only when the
 * merchant saves a different font, so rebuilding it per request would be pure
 * waste on the hottest path in the app. The map is bounded by the number of
 * font URLs a store has ever used in one process lifetime.
 */
const policies = new Map<string, RequestHandler>();

function currentPolicy(): RequestHandler {
  const key = fontOrigins.join(" ");

  let policy = policies.get(key);
  if (!policy) {
    policy = policyFor(fontOrigins);
    policies.set(key, policy);
  }

  return policy;
}

export const securityHeaders: RequestHandler = (req, res, next) => currentPolicy()(req, res, next);

/**
 * Login rate limits.
 *
 * v1 used `max: 1` per 15 seconds, which locked out a user who mistyped their
 * password once while barely inconveniencing an attacker. This allows a normal
 * retry pattern and still caps sustained guessing.
 *
 * Two separate instances, not one shared by IP: a single limiter on the admin
 * login, invite acceptance, the admin password change, the customer login,
 * email verification and the customer password reset meant ten wrong customer
 * passwords from one address could lock the merchant out of their own admin
 * for fifteen minutes — a shared office NAT or a campus turns that into a
 * lockout nobody can explain from the inside. Keyed by IP, not by email:
 * keying by the account identifier would hand an attacker a way to lock out a
 * victim by name, which is worse than the shared-IP problem this replaces.
 */
export const adminLoginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many sign-in attempts. Try again in a few minutes." },
});

export const customerLoginRateLimit = rateLimit({
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
 * The login limiters skip successful responses, which is right for a login and
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

/**
 * Public image uploads — the postcard designer.
 *
 * Anyone can save a design without an account, which is the whole point of
 * guest checkout, and every save is a decode, two resizes and a write. The
 * ceiling is what a person trying a few photos needs; a script gets 429 and
 * the disk stays the operator's.
 */
export const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many uploads. Try again in a few minutes." },
});

/**
 * Address verification — a public route that calls a paid Lob endpoint.
 *
 * Generous enough for a bulk upload (a few hundred rows, with the server's
 * own cache absorbing repeats) and small enough that the endpoint is not a
 * free verifier for the internet. Every response counts.
 */
export const verifyRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many address checks. Try again in an hour." },
});

/**
 * "Send me your address" responses — a public write into someone's book.
 *
 * A responder submits once. This is the ceiling on a script trying tokens
 * or filling a collector link with junk; the per-link caps are in the
 * repository.
 */
export const requestRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many submissions. Try again in an hour." },
});

/** The card-code page and its reaction: a scan or two per card, not a scanner. */
export const replyRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Try again in an hour." },
});

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * A broad ceiling on write traffic, so a loop cannot hammer the database.
 *
 * Mounted once on the whole admin router (see `adminRouter.use` in
 * `routes/admin.ts`) alongside `requireAdmin` and `verifyCsrf`, both of which
 * are meant to apply to every method — this one is not: a busy admin session
 * is mostly `GET`s (the dashboard alone fires five on load), and counting
 * those against the same 120-a-minute budget as writes meant a few page loads
 * could exhaust it, after which every read silently 429'd. `skip` keeps reads
 * off the ceiling without having to mount this selectively route by route.
 */
export const writeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => SAFE_METHODS.has(req.method),
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
