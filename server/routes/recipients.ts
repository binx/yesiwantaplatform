import { Router } from "express";
import { recipientSchema } from "../../shared/postcards.js";
import { verifyRecipient } from "../lob.js";
import { httpError, verifyCsrf, verifyRateLimit } from "../middleware.js";

/**
 * Address verification for the recipient form.
 *
 * Public, because guest checkout is — but behind its own limiter, since
 * every call past the cache is one Lob bills for. The answer never blocks a
 * sale on its own: `verifyRecipient` turns Lob being unavailable into
 * `unknown`, and the form adds the address as typed.
 */
export const recipientsRouter: Router = Router();

recipientsRouter.post("/recipients/verify", verifyRateLimit, verifyCsrf, async (req, res) => {
  const parsed = recipientSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw httpError(400, first ? `${first.path.join(".")}: ${first.message}` : "That address could not be read.");
  }

  res.json(await verifyRecipient(parsed.data));
});
