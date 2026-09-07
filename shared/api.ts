import { z } from "zod";
import {
  centsSchema,
  collectionSchema,
  inventorySchema,
  optionGroupSchema,
  productSchema,
  slugSchema,
  storeSchema,
  themeSchema,
} from "./schema.js";

/**
 * Request and response contracts, validated on both sides of the wire.
 *
 * Everything the client sends is parsed here before it reaches the database.
 * Note what is absent: no request carries a price for something being bought.
 * Checkout line items are built server-side from stored prices in Phase 3.
 */

export const variantInputSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().default(""),
  priceCents: centsSchema,
  inventory: inventorySchema,
});

export const productInputSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(5000).default(""),
  bulletPoints: z.array(z.string().max(300)).max(20).default([]),
  variantName: z.string().max(50).nullable().default(null),
  variants: z.array(variantInputSchema).min(1).max(50),
  optionGroups: z.array(optionGroupSchema).max(10).default([]),
  isLive: z.boolean().default(false),
});

export const collectionInputSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(200),
  productIds: z.array(z.string()).max(500).default([]),
});

export const settingsInputSchema = z.object({
  name: z.string().min(1).max(120),
  currency: z.string().length(3),
  /** Publishable key only; a secret key here is rejected outright. */
  stripePublishableKey: z
    .string()
    .startsWith("pk_", "That looks like a secret key. Only the publishable key belongs here.")
    .nullable()
    .default(null),
  aboutText: z.string().max(20000).nullable().default(null),
  theme: themeSchema,
});

export const loginInputSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(400),
});

export const imageInputSchema = z.object({
  alt: z.string().max(300).default(""),
});

export const reorderInputSchema = z.object({
  ids: z.array(z.string().min(1)).max(1000),
});

export const imagePathInputSchema = z.object({
  path: z.string().min(1).max(512),
});

export const imageReorderInputSchema = z.object({
  paths: z.array(z.string().min(1).max(512)).max(100),
});

/**
 * Paging is clamped rather than rejected, so an over-eager client gets a
 * sensible page instead of a 400 — and matches what `listProducts` enforces.
 */
export const productQuerySchema = z.object({
  collection: z.string().optional(),
  search: z.string().max(120).optional(),
  limit: z.coerce
    .number()
    .int()
    .catch(50)
    .transform((value) => Math.min(Math.max(value, 1), 200)),
  offset: z.coerce
    .number()
    .int()
    .catch(0)
    .transform((value) => Math.max(value, 0)),
});

export const storeResponseSchema = storeSchema;

export const productPageResponseSchema = z.object({
  products: z.array(productSchema),
  total: z.number().int().min(0),
  limit: z.number().int(),
  offset: z.number().int(),
});

export const sessionResponseSchema = z.object({
  isAdmin: z.boolean(),
  csrfToken: z.string(),
  /** False until settings and an admin user exist. */
  isConfigured: z.boolean(),
});

export const collectionsResponseSchema = z.array(collectionSchema);

export type VariantInput = z.infer<typeof variantInputSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type CollectionInput = z.infer<typeof collectionInputSchema>;
export type SettingsInput = z.infer<typeof settingsInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type ProductQuery = z.infer<typeof productQuerySchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type ProductPageResponse = z.infer<typeof productPageResponseSchema>;
