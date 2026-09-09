import { Router } from "express";
import { verify } from "@node-rs/argon2";
import { storefrontUnlockInputSchema } from "../../shared/api.js";
import { getStorefrontState } from "../../db/repository.js";
import { hashToken, safeEqual } from "../auth.js";
import { httpError, sessionOp, storefrontUnlockRateLimit } from "../middleware.js";

/**
 * The one route a locked storefront answers with no admin session and no
 * CSRF token — see docs/tasks/27-storefront-preview-mode.md §6 and §Security.
 *
 * Mounted above `requireStorefrontAccess` in server/app.ts, alongside the
 * session and setup routers: a visitor who has not passed the gate is exactly
 * who needs to reach this.
 */
export const storefrontRouter: Router = Router();

/**
 * No CSRF check, deliberately. The synchroniser token defends against a
 * forged request that makes the *victim's* browser do something on their
 * behalf without their consent. The only thing this route can be forged into
 * doing is granting the victim read access to a store whose password the
 * attacker already has to know — which is not a privilege escalation, it is
 * the attacker sharing what they already possess. `PUBLIC_CART_TOKEN_ROUTES`
 * in server/security.test.ts is the precedent for recording a deliberate
 * omission here rather than leaving it to be rediscovered.
 */
storefrontRouter.post("/storefront/unlock", storefrontUnlockRateLimit, async (req, res) => {
  const parsed = storefrontUnlockInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "A password or a link is required.");

  const state = await getStorefrontState();
  if (!state || state.access === "public") {
    // Nothing to unlock. Answering success would be a lie; answering the same
    // 401 the gate itself gives would claim a lock that does not exist.
    throw httpError(409, "This store is not locked.");
  }

  const { password, token } = parsed.data;
  const { passwordHash, shareTokenHash } = state;

  let ok = false;
  if (password && passwordHash) {
    ok = await verify(passwordHash, password).catch(() => false);
  }
  if (!ok && token && shareTokenHash) {
    ok = safeEqual(hashToken(token), shareTokenHash);
  }

  if (!ok) throw httpError(401, "Incorrect password.");

  // Regenerate the session, as every other privilege change in this codebase
  // does — this is one, even though it grants read access rather than an
  // account.
  await sessionOp((done) => req.session.regenerate(done));

  req.session.storefrontAccess = state.accessVersion;

  await sessionOp((done) => req.session.save(done));

  res.status(204).end();
});
