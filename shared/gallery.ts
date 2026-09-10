import { z } from "zod";
import { postcardDesignSchema, postcardSchema } from "./postcards.js";

/**
 * The gallery: everything a customer has designed, with where each card
 * went. A design row belongs to one order; "send again" duplicates it, so
 * the gallery groups copies under the design they were made from.
 */
export const designCountsSchema = z.object({
  total: z.number().int(),
  scheduled: z.number().int(),
  sent: z.number().int(),
  /** Sent cards whose tracking reached the recipient's post office or beyond. Zero without a Lob webhook. */
  delivered: z.number().int(),
  error: z.number().int(),
  cancelled: z.number().int(),
  firstMailDate: z.string().nullable(),
  lastMailDate: z.string().nullable(),
});

export const galleryDesignSchema = postcardDesignSchema.extend({
  /** Whether an order holds cards of this design. False: a draft. */
  ordered: z.boolean(),
  /** The design this was duplicated from, when it was. */
  originId: z.string().nullable(),
  /** The print file is still here, so a copy prints exactly this. */
  canSendAgain: z.boolean(),
  postcards: designCountsSchema,
});

export const galleryPageSchema = z.object({
  designs: z.array(galleryDesignSchema),
  nextCursor: z.string().nullable(),
});

export const galleryDetailSchema = galleryDesignSchema.extend({
  /** Every card of this design across the customer's orders, through the customer view. */
  cards: z.array(postcardSchema),
  /** Copies "send again" made, newest first. */
  copies: z.array(galleryDesignSchema),
});

export type DesignCounts = z.infer<typeof designCountsSchema>;
export type GalleryDesign = z.infer<typeof galleryDesignSchema>;
export type GalleryPage = z.infer<typeof galleryPageSchema>;
export type GalleryDetail = z.infer<typeof galleryDetailSchema>;

/** One line under a thumbnail: what happened to this design. */
export function summariseDesign(design: Pick<GalleryDesign, "ordered" | "postcards">): string {
  const { total, scheduled, sent, delivered, error } = design.postcards;
  if (!design.ordered || total === 0) return "Draft";
  const parts: string[] = [];
  if (sent > 0) parts.push(delivered > 0 ? `${sent} sent, ${delivered} delivered` : `${sent} sent`);
  if (scheduled > 0) parts.push(`${scheduled} scheduled`);
  if (error > 0) parts.push(`${error} need${error === 1 ? "s" : ""} attention`);
  return parts.length > 0 ? parts.join(" · ") : `${total} postcard${total === 1 ? "" : "s"}`;
}
