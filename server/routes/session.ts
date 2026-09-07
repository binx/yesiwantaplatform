import { Router } from "express";
import { loginInputSchema, type SessionResponse } from "../../shared/api.js";
import { isConfigured } from "../../db/repository.js";
import { verifyLogin } from "../auth.js";
import { csrfToken, httpError, loginRateLimit, verifyCsrf } from "../middleware.js";

export const sessionRouter: Router = Router();

/** express-session's callbacks pass `any`; normalise to a real Error. */
function callback(run: (done: (error?: unknown) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    run((error) => {
      if (!error) return resolve();
      reject(error instanceof Error ? error : new Error("Session operation failed."));
    });
  });
}

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

sessionRouter.post("/session", loginRateLimit, verifyCsrf, async (req, res) => {
  const parsed = loginInputSchema.safeParse(req.body);
  // Deliberately vague: do not reveal which field was wrong.
  if (!parsed.success) throw httpError(400, "Email and password are required.");

  const admin = await verifyLogin(parsed.data.email, parsed.data.password);
  if (!admin) throw httpError(401, "Incorrect email or password.");

  // Prevent session fixation: a new id is issued on privilege change.
  await callback((done) => req.session.regenerate(done));

  req.session.adminId = admin.id;
  const token = csrfToken(req);

  await callback((done) => req.session.save(done));

  res.json({ isAdmin: true, csrfToken: token, isConfigured: true } satisfies SessionResponse);
});

sessionRouter.delete("/session", verifyCsrf, async (req, res) => {
  await new Promise<void>((resolve) => {
    req.session.destroy(() => resolve());
  });

  res.clearCookie("beluga.sid");
  res.status(204).end();
});
