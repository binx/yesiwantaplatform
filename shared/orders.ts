import { z } from "zod";
import { cartLineSchema } from "./cart.js";
import { centsSchema } from "./schema.js";
import { postcardDesignSchema, postcardSchema } from "./postcards.js";

/**
 * Orders.
 *
 * Stripe is the authority on payment; everything about fulfilment lives here.
 * An order is a bag of postcards — each with its own recipient and mail date —
 * plus the designs they reference, carried along so an order page can show
 * the thumbnails without a second request.
 */

export const orderStatusSchema = z.enum([
  /** Checkout Session created, payment not yet confirmed. */
  "pending",
  /** Webhook confirmed payment; postcards are scheduled. */
  "paid",
  /** Every postcard has gone to print. */
  "completed",
  "cancelled",
  "refunded",
]);

export const orderSchema = z.object({
  id: z.string(),
  /** Short, human-quotable reference shown to customers. */
  reference: z.string(),
  /**
   * The Stripe session that paid for it. Unguessable, and the credential a
   * guest's confirmation link carries — so it is the one thing that lets an
   * email say "follow your postcards here" to someone with no account.
   */
  checkoutSessionId: z.string(),
  email: z.string(),
  status: orderStatusSchema,
  currency: z.string(),
  /** What one card cost on this order — a snapshot, in case the price moves. */
  unitPriceCents: centsSchema,
  postcardCount: z.number().int().min(0),
  /** How many of those went abroad, and what each of them cost. Zero and null on a domestic order. */
  internationalCount: z.number().int().min(0).default(0),
  internationalUnitPriceCents: centsSchema.nullable().default(null),
  subtotalCents: centsSchema,
  /**
   * What a promotion code took off, as a positive number. Stored, not
   * subtracted: `subtotalCents` is Stripe's pre-discount figure and
   * `totalCents` its post-discount one.
   */
  discountCents: centsSchema,
  totalCents: centsSchema,
  /** Cumulative amount refunded. Below `totalCents` means partial. */
  refundedCents: centsSchema,
  /** The card this order was sent back to, when it is a reply. */
  replyToPostcardId: z.string().nullable().default(null),
  createdAt: z.number().int(),
  postcards: z.array(postcardSchema),
  designs: z.array(postcardDesignSchema),
});

/** What the client sends to start a checkout: design ids, dates and recipients. Never a price. */
export const checkoutRequestSchema = z.object({
  lines: z.array(cartLineSchema).min(1).max(20),
});

/**
 * An order the administrator places for free — v1's "free postcards" route.
 * The same lines as a checkout; the difference is who is asking and that
 * nothing is charged.
 */
export const complimentaryOrderInputSchema = z.object({
  lines: z.array(cartLineSchema).min(1).max(20),
});

export const checkoutResponseSchema = z.object({
  url: z.string().url(),
  orderId: z.string(),
});

/** Stripe's own refund reasons; there is no free-text option on the API. */
export const refundReasonSchema = z.enum(["duplicate", "fraudulent", "requested_by_customer"]);

export const refundInputSchema = z.object({
  /** Omit to refund the full remaining amount. */
  amountCents: centsSchema.nullable().default(null),
  reason: refundReasonSchema.default("requested_by_customer"),
  notify: z.boolean().default(false),
});

export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type Order = z.infer<typeof orderSchema>;
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
export type ComplimentaryOrderInput = z.infer<typeof complimentaryOrderInputSchema>;
export type RefundReason = z.infer<typeof refundReasonSchema>;
export type RefundInput = z.infer<typeof refundInputSchema>;

/**
 * A short order reference derived from the row id.
 *
 * v1 showed a slice of a Stripe identifier, which leaked the payment
 * object's id to the customer.
 */
export function orderReference(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** How many of an order's postcards are in each state — for a one-line summary. */
export function summarisePostcards(order: Pick<Order, "postcards">) {
  const counts = { scheduled: 0, sent: 0, error: 0, cancelled: 0, pending: 0 };
  for (const postcard of order.postcards) {
    if (postcard.status === "sending") counts.scheduled += 1;
    else counts[postcard.status] += 1;
  }
  return counts;
}
