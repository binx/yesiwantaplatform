import { Router } from "express";
import { replyCodeSchema } from "../../shared/postcards.js";
import type { ReplyCard } from "../../shared/reply.js";
import { getReplySettings } from "../../db/customers-repository.js";
import { toEpochMs } from "../../db/repository.js";
import { getDesign, toPublicDesign } from "../../db/designs-repository.js";
import { findPostcardByReplyCode, type ReplyTarget } from "../../db/orders-repository.js";
import { httpError, replyRateLimit, verifyCsrf } from "../middleware.js";

/**
 * The card behind a code on the back of a postcard.
 *
 * Holding the card is the credential. What it unlocks is the card itself —
 * the front, the message, a first name — and two acts: saying it arrived,
 * and sending one back. Opening the page records nothing about the reader;
 * only the tap does, and only what they chose to say.
 */
export const replyRouter: Router = Router();

/** How long after mailing a code works even with no tracking to say the card landed. */
const LANDED_AFTER_DAYS = 7;
const LANDED = new Set(["postcard.processed_for_delivery", "postcard.delivered"]);

/**
 * Nothing is live before the card lands. A code printed on a card still in
 * the post is not yet a key to anything, so the page answers 404 until the
 * tracking says the card reached its post office — or a week has passed
 * since mailing, for a store without the tracking webhook.
 */
function hasLanded(target: ReplyTarget): boolean {
  const { postcard } = target;
  if (postcard.status !== "sent" || postcard.replyDisabledAt !== null) return false;
  if (postcard.trackingStatus && LANDED.has(postcard.trackingStatus)) return true;
  const sentAt = postcard.sentAt === null || postcard.sentAt === undefined ? null : toEpochMs(postcard.sentAt);
  return sentAt !== null && Date.now() - sentAt >= LANDED_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

async function lookUp(raw: string): Promise<ReplyTarget> {
  const code = replyCodeSchema.safeParse(raw);
  const target = code.success ? await findPostcardByReplyCode(code.data) : null;
  if (!target || !hasLanded(target)) throw httpError(404, "There's no postcard here.");
  return target;
}

replyRouter.get("/r/:code", replyRateLimit, verifyCsrf, async (req, res) => {
  const target = await lookUp(String(req.params.code));
  const design = await getDesign(target.postcard.designId);
  if (!design) throw httpError(404, "There's no postcard here.");

  const settings = target.order.customerId ? await getReplySettings(target.order.customerId) : null;
  const front = toPublicDesign(design);

  res.json({
    front: front.thumbnail,
    orientation: front.orientation,
    back: design.back,
    senderName: settings?.displayName ?? null,
    mailedOn: target.postcard.mailDate,
    canReply: Boolean(settings?.address && settings.displayName),
  } satisfies ReplyCard);
});
