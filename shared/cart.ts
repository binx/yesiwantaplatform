import { z } from "zod";

/**
 * Cart persistence and recovery — see docs/tasks/12-abandoned-cart.md.
 *
 * `cartLineSchema` mirrors the line shape inline in `checkoutRequestSchema`
 * (shared/orders.ts): identifiers and a quantity, never a price.
 */
export const cartLineSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(999),
  options: z.record(z.string(), z.string()).default({}),
});

export const cartSyncInputSchema = z.object({
  lines: z.array(cartLineSchema).max(100),
});

export const cartRecoverInputSchema = z.object({
  token: z.string().min(1),
});

export const cartUnsubscribeInputSchema = z.object({
  token: z.string().min(1),
});

export type CartLine = z.infer<typeof cartLineSchema>;
export type CartSyncInput = z.infer<typeof cartSyncInputSchema>;
export type CartRecoverInput = z.infer<typeof cartRecoverInputSchema>;
export type CartUnsubscribeInput = z.infer<typeof cartUnsubscribeInputSchema>;
