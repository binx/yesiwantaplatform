import { z } from "zod";
import { imageSchema } from "./schema.js";
import { mailDateSchema, orientationSchema, postcardBackSchema } from "./postcards.js";

/**
 * What the holder of a card's code is shown: the card, who it came from by
 * first name, and whether a reply is possible. Never an address, never an
 * email, never the print file.
 */
export const replyCardSchema = z.object({
  /** The 600px thumbnail — the print file is never served. */
  front: imageSchema,
  orientation: orientationSchema,
  back: postcardBackSchema,
  /** The sender's chosen name, or null for a guest sender. */
  senderName: z.string().nullable(),
  mailedOn: mailDateSchema,
  /** The sender is a customer with a reply address, and has not turned the link off. */
  canReply: z.boolean(),
});

export type ReplyCard = z.infer<typeof replyCardSchema>;

/** The sender's reply settings: a name to show, and where a reply is mailed. */
export const replyAddressInputSchema = z.object({
  displayName: z.string().trim().min(1, "A name is required.").max(40, "40 characters at most."),
});
