import { z } from "zod";
import { centsSchema } from "./schema.js";

/**
 * Orders.
 *
 * Stripe's Orders API is gone and has no server-side replacement, so an order
 * is a record we own. Stripe remains the authority on *payment*; everything
 * about fulfilment lives here.
 */

export const orderStatusSchema = z.enum([
  /** Checkout Session created, payment not yet confirmed. */
  "pending",
  /** Webhook confirmed payment. */
  "paid",
  "processing",
  "shipped",
  "cancelled",
  "refunded",
]);

export const orderItemSchema = z.object({
  id: z.string(),
  productId: z.string().nullable(),
  variantId: z.string().nullable(),
  /**
   * Snapshots taken at purchase. An order must always render as it was bought,
   * even after the product is renamed, repriced, or deleted.
   */
  productName: z.string(),
  variantLabel: z.string(),
  unitPriceCents: centsSchema,
  quantity: z.number().int().positive(),
  options: z.record(z.string(), z.string()),
});

export const shippingAddressSchema = z.object({
  name: z.string().nullable(),
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
});

export const orderSchema = z.object({
  id: z.string(),
  /** Short, human-quotable reference shown to customers. */
  reference: z.string(),
  email: z.string(),
  status: orderStatusSchema,
  currency: z.string(),
  subtotalCents: centsSchema,
  shippingCents: centsSchema,
  taxCents: centsSchema,
  totalCents: centsSchema,
  shipping: shippingAddressSchema,
  carrier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  /**
   * Set when payment succeeded but stock had run out in the meantime. The
   * money is taken, so the order is recorded and flagged for the owner rather
   * than silently oversold or dropped.
   */
  oversold: z.boolean(),
  createdAt: z.number().int(),
  items: z.array(orderItemSchema),
});

/** What the client sends to start a checkout: identifiers only, never prices. */
export const checkoutRequestSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().min(1),
        quantity: z.number().int().min(1).max(999),
        options: z.record(z.string(), z.string()).default({}),
      }),
    )
    .min(1)
    .max(100),
  /** Optional shipping rate chosen on the cart page. */
  shippingRateId: z.string().nullable().default(null),
  /**
   * Where it is going, chosen on the cart page.
   *
   * Needed *before* the session exists: hosted Checkout collects the address
   * afterwards, so zone-priced rates would otherwise be picked blind. The
   * session then restricts address collection to this country, so the buyer
   * cannot switch zones at Stripe and pay the wrong postage.
   */
  shipToCountry: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .nullable()
    .default(null),
});

export const checkoutResponseSchema = z.object({
  url: z.string().url(),
  orderId: z.string(),
});

export const fulfilmentInputSchema = z.object({
  status: orderStatusSchema,
  carrier: z.string().max(80).nullable().default(null),
  trackingNumber: z.string().max(120).nullable().default(null),
  /** Send the customer an email about this change. */
  notify: z.boolean().default(false),
});

export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type Order = z.infer<typeof orderSchema>;
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
export type FulfilmentInput = z.infer<typeof fulfilmentInputSchema>;

/**
 * A short order reference derived from the row id.
 *
 * v1 showed `order.id.split("_")[1]` — a slice of a Stripe identifier, which
 * leaked the payment object's id to the customer.
 */
export function orderReference(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}
