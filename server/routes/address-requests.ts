import { Router } from "express";
import { addressRequestResponseSchema, type AddressRequestPublic } from "../../shared/account.js";
import { formatRecipient } from "../../shared/postcards.js";
import { RequestClosedError, findAddressRequestByToken, recordAddressResponse } from "../../db/address-requests-repository.js";
import { sendAddressReceivedEmail } from "../email.js";
import { env } from "../env.js";
import { verifyRecipient } from "../lob.js";
import { httpError, requestRateLimit, verifyCsrf } from "../middleware.js";

/**
 * The responder's side of a "send me your address" link.
 *
 * Public: the person opening it has no account and is not asked for one.
 * What they are shown is a first name and a form; what they can do is put
 * one address into the requester's book. The token is the credential —
 * 256 random bits — and a miss is a 404 with nothing to learn from it.
 */
export const addressRequestsRouter: Router = Router();

// Per route, not `router.use`: mounted under /api, a router-wide middleware
// would run for every /api request that passes through on its way to a
// later router, and turn the admin's anonymous 401s into CSRF 403s.

/** The requester's first name, or a stand-in: the page never says "Someone would like…" without a name on purpose. */
function firstName(name: string | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first && first !== "" ? first : "A friend";
}

addressRequestsRouter.get("/address-requests/:token", verifyCsrf, async (req, res) => {
  const found = await findAddressRequestByToken(String(req.params.token));
  if (!found) throw httpError(404, "That link isn't one we know.");

  res.json({
    requesterName: firstName(found.requester.name),
    label: found.request.multi ? found.request.label : null,
    multi: found.request.multi,
    status: found.request.status,
  } satisfies AddressRequestPublic);
});

addressRequestsRouter.post("/address-requests/:token", requestRateLimit, verifyCsrf, async (req, res) => {
  const found = await findAddressRequestByToken(String(req.params.token));
  if (!found) throw httpError(404, "That link isn't one we know.");
  if (found.request.status !== "open") throw httpError(410, new RequestClosedError(found.request.status).message);

  const parsed = addressRequestResponseSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw httpError(400, first ? `${first.path.join(".")}: ${first.message}` : "That address could not be used.");
  }

  // The same check the requester's own form runs: an address USPS does not
  // know at all would only become a parked card later.
  const verification = await verifyRecipient(parsed.data);
  if (verification.deliverability === "undeliverable") {
    throw httpError(400, "USPS doesn't recognize this address. Check the street number and the ZIP.");
  }

  let saved;
  try {
    saved = await recordAddressResponse(found.request, parsed.data, { verified: verification.deliverability === "deliverable" });
  } catch (error) {
    if (error instanceof RequestClosedError) throw httpError(410, error.message);
    throw error;
  }

  if (found.request.notifyByEmail) {
    void sendAddressReceivedEmail(found.requester.email, {
      name: saved.name,
      address: formatRecipient(saved),
      bookUrl: new URL("/account/recipients", env.PUBLIC_URL).toString(),
    });
  }

  res.status(204).end();
});
