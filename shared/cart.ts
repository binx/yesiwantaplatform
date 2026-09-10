import { z } from "zod";
import { isInternational, mailDateSchema, recipientSchema } from "./postcards.js";

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

export const cartLineSchema = z.object({
  designs: z.array(scheduledDesignSchema).min(1).max(50),
  recipients: z.array(recipientSchema).min(1).max(500),
});

export type ScheduledDesign = z.infer<typeof scheduledDesignSchema>;
export type CartLine = z.infer<typeof cartLineSchema>;

/** Postcards in a line, or across several. */
export function countPostcards(lines: readonly Pick<CartLine, "designs" | "recipients">[]): number {
  return lines.reduce((total, line) => total + line.designs.length * line.recipients.length, 0);
}

/**
 * The same count split by destination, because the two are priced apart:
 * Lob charges more to mail abroad and the store charges its own second price.
 */
export function countPostcardsByDestination(
  lines: readonly Pick<CartLine, "designs" | "recipients">[],
): { domestic: number; international: number } {
  let domestic = 0;
  let international = 0;
  for (const line of lines) {
    const abroad = line.recipients.filter(isInternational).length;
    international += line.designs.length * abroad;
    domestic += line.designs.length * (line.recipients.length - abroad);
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
