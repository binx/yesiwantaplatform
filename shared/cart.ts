import { z } from "zod";
import { isInternational, mailDateSchema, recipientSchema, replyCodeSchema } from "./postcards.js";

/**
 * The cart.
 *
 * A line is a *batch*: some designs, each with a day to mail it, going to
 * some recipients. Every design goes to every recipient, so a line of three
 * designs and four recipients is twelve postcards. That product is the whole
 * pricing model, and it is computed from the line's shape rather than stored
 * — the same rule Beluga applied to prices, applied to quantity.
 *
 * Designs are referenced by id: the image and the message live server-side
 * from the moment a design is saved, so the cart holds nothing displayable
 * and re-resolves each design against the API on render. Recipients are held
 * inline — they exist nowhere else until checkout.
 */

export const scheduledDesignSchema = z.object({
  designId: z.string().min(1),
  mailDate: mailDateSchema,
});

export const cartLineSchema = z
  .object({
    designs: z.array(scheduledDesignSchema).min(1).max(50),
    recipients: z.array(recipientSchema).max(500).default([]),
    /** Print a QR code on the back so the recipient can see the card online and send one back. */
    replyLink: z.boolean().default(true),
    /**
     * A reply: the recipient is the sender of the card with this code, and
     * is resolved on the server at checkout. The line carries no address.
     */
    replyTo: replyCodeSchema.nullable().default(null),
    /** The sender's display name, for the cart to show. The server ignores it. */
    replyToName: z.string().max(40).nullable().default(null),
  })
  .superRefine((line, ctx) => {
    if (line.replyTo === null && line.recipients.length === 0) {
      ctx.addIssue({ code: "custom", path: ["recipients"], message: "At least one recipient." });
    }
    if (line.replyTo !== null && line.recipients.length > 0) {
      ctx.addIssue({ code: "custom", path: ["recipients"], message: "A reply goes to one person: the sender." });
    }
  });

export type ScheduledDesign = z.infer<typeof scheduledDesignSchema>;
export type CartLine = z.infer<typeof cartLineSchema>;
/** A line before the schema's defaults: what a caller may build by hand. */
export type CartLineInput = z.input<typeof cartLineSchema>;

/** How many people a line goes to: its recipients, or the one sender it replies to. */
export function lineRecipientCount(line: Pick<CartLineInput, "recipients" | "replyTo">): number {
  return line.replyTo ? 1 : (line.recipients ?? []).length;
}

/** Postcards in a line, or across several. */
export function countPostcards(lines: readonly Pick<CartLineInput, "designs" | "recipients" | "replyTo">[]): number {
  return lines.reduce((total, line) => total + line.designs.length * lineRecipientCount(line), 0);
}

/**
 * The same count split by destination, because the two are priced apart:
 * Lob charges more to mail abroad and the store charges its own second price.
 */
export function countPostcardsByDestination(
  lines: readonly Pick<CartLineInput, "designs" | "recipients" | "replyTo">[],
): { domestic: number; international: number } {
  let domestic = 0;
  let international = 0;
  for (const line of lines) {
    // A reply's recipient is resolved on the server; until then it counts as
    // domestic, which is what a reply address is unless the shop mails abroad.
    const abroad = (line.recipients ?? []).filter((r) => isInternational({ country: r.country ?? "US" })).length;
    international += line.designs.length * abroad;
    domestic += line.designs.length * (lineRecipientCount(line) - abroad);
  }
  return { domestic, international };
}

export const cartSyncInputSchema = z.object({
  lines: z.array(cartLineSchema).max(20),
});

export const cartRecoverInputSchema = z.object({
  token: z.string().min(1),
});

export const cartUnsubscribeInputSchema = z.object({
  token: z.string().min(1),
});

export type CartSyncInput = z.infer<typeof cartSyncInputSchema>;
export type CartRecoverInput = z.infer<typeof cartRecoverInputSchema>;
export type CartUnsubscribeInput = z.infer<typeof cartUnsubscribeInputSchema>;
