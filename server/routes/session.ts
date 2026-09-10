import { Router } from "express";
import {
  forgotPasswordInputSchema,
  loginInputSchema,
  resetPasswordInputSchema,
  type SessionResponse,
} from "../../shared/api.js";
import { isConfigured } from "../../db/repository.js";
import {
  TokenNotUsableError,
  consumeAdminPasswordResetToken,
  createAdminPasswordResetToken,
  destroySessionsForUser,
  recordLogin,
  verifyLogin,
} from "../auth.js";
import { sendAccountEmail } from "../email.js";
import { env } from "../env.js";
import {
  adminLoginRateLimit,
  csrfToken,
  emailRateLimit,
  httpError,
  sessionOp,
  verifyCsrf,
} from "../middleware.js";

export const sessionRouter: Router = Router();

/**
 * Current session.
 *
 * v1's `/user` returned `{ isAdmin: true }` for everyone whenever NODE_ENV was
 * not "production", which is the default — so a plain `node server` handed the
 * admin UI to any visitor. Admin status here comes only from a real session.
 */
sessionRouter.get("/session", async (req, res) => {
  const body: SessionResponse = {
    isAdmin: Boolean(req.session.adminId),
    csrfToken: csrfToken(req),
    isConfigured: await isConfigured(),
  };
  res.json(body);
});

sessionRouter.post("/session", adminLoginRateLimit, verifyCsrf, async (req, res) => {
  const parsed = loginInputSchema.safeParse(req.body);
  // Deliberately vague: do not reveal which field was wrong.
  if (!parsed.success) throw httpError(400, "Email and password are required.");

  const admin = await verifyLogin(parsed.data.email, parsed.data.password);
  if (!admin) throw httpError(401, "Incorrect email or password.");

  // Prevent session fixation: a new id is issued on privilege change.
  await sessionOp((done) => req.session.regenerate(done));

  req.session.adminId = admin.id;
  const token = csrfToken(req);

  await sessionOp((done) => req.session.save(done));

  // Best-effort: the staff list is nicer with it, and nobody should be locked
  // out because a timestamp write failed.
  await recordLogin(admin.id).catch(() => {});

  res.json({ isAdmin: true, csrfToken: token, isConfigured: true } satisfies SessionResponse);
});

sessionRouter.delete("/session", verifyCsrf, async (req, res) => {
  await new Promise<void>((resolve) => {
    req.session.destroy(() => resolve());
  });

  res.clearCookie("beluga.sid");
  res.status(204).end();
});


/**
 * Request a reset link for a forgotten admin password.
 *
 * Public by necessity: an administrator
 * who has lost their password cannot sign in to ask for one. Reuses the
 * customer flow's shape from server/routes/account.ts — 204 always, an email
 * sent only when the address belongs to an administrator, and every response
 * counted by `emailRateLimit` rather than `adminLoginRateLimit`, since a request
 * that always answers 204 never counts under the limiter that skips
 * successes.
 */
sessionRouter.post("/session/forgot-password", emailRateLimit, verifyCsrf, async (req, res) => {
  const parsed = forgotPasswordInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "Enter a valid email address.");

  const token = await createAdminPasswordResetToken(parsed.data.email);
  if (token) {
    const resetUrl = new URL(`/admin/reset-password?token=${token}`, env.PUBLIC_URL).toString();
    void sendAccountEmail("ResetPassword", parsed.data.email, resetUrl);
  }

  res.status(204).end();
});

/**
 * Redeem a reset link and choose a new password.
 *
 * Destroys every session the account had — the same behaviour
 * `PUT /api/admin/users/me/password` already has, except with no session to
 * except: whoever reset the password was, by definition, not signed in.
 */
sessionRouter.post("/session/reset-password", emailRateLimit, verifyCsrf, async (req, res) => {
  const parsed = resetPasswordInputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw httpError(400, parsed.error.issues[0]?.message ?? "That could not be used.");
  }

  let adminId: string;
  try {
    adminId = await consumeAdminPasswordResetToken(parsed.data.token, parsed.data.password);
  } catch (error) {
    if (error instanceof TokenNotUsableError) throw httpError(410, error.message);
    throw error;
  }

  await destroySessionsForUser(adminId);

  res.status(204).end();
});
