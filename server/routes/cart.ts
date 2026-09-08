import { Router } from "express";
import {
  cartRecoverInputSchema,
  cartSyncInputSchema,
  cartUnsubscribeInputSchema,
} from "../../shared/cart.js";
import {
  CartTokenNotUsableError,
  recoverCart,
  syncCart,
  unsubscribeFromCartRecovery,
} from "../cart-recovery.js";
import { httpError, requireCustomer, verifyCsrf, writeRateLimit } from "../middleware.js";

/**
 * Cart persistence and recovery — see docs/tasks/12-abandoned-cart.md.
 *
 * Mounted at its own `/api/cart` prefix in server/app.ts, not the shared
 * `/api` that checkout and shipping use — same reasoning as `accountRouter`
 * living at `/api/account` and `adminRouter` at `/api/admin`. A router-wide
 * `.use()` middleware with no path (the `writeRateLimit`/`verifyCsrf` below)
 * runs for *every* request that reaches the router, matched route or not; at
 * a shared prefix like `/api` that would fire — and 403 — on every other
 * router's requests too, before they ever got a chance to match elsewhere.
 */
export const cartRouter: Router = Router();

cartRouter.use(writeRateLimit, verifyCsrf);

cartRouter.post("/sync", requireCustomer, async (req, res) => {
  const parsed = cartSyncInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "That cart could not be read.");

  await syncCart(req.session.customerId!, parsed.data.lines);
  res.status(204).end();
});

cartRouter.post("/recover", async (req, res) => {
  const parsed = cartRecoverInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "That recovery link could not be used.");

  try {
    const lines = await recoverCart(parsed.data.token);
    res.json({ lines });
  } catch (error) {
    if (error instanceof CartTokenNotUsableError) throw httpError(410, error.message);
    throw error;
  }
});

cartRouter.post("/unsubscribe", async (req, res) => {
  const parsed = cartUnsubscribeInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "That link could not be used.");

  await unsubscribeFromCartRecovery(parsed.data.token);
  res.status(204).end();
});
