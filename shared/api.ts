import { z } from "zod";
import { countryCodeSchema, shippingRateInputSchema, shippingZoneInputSchema } from "./shipping.js";
import {
  centsSchema,
  collectionSchema,
  inventorySchema,
  optionGroupSchema,
  productSchema,
  RESERVED_PAGE_SLUGS,
  slugSchema,
  storeSchema,
  taxBehaviorSchema,
  taxCodeSchema,
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
  /**
   * Regenerated server-side from `optionValues` whenever the product has any
   * options — see `regenerateLabel` in shared/product-options.ts. What is sent
   * here only matters for a product with no options at all.
   */
  label: z.string().default(""),
  priceCents: centsSchema,
  inventory: inventorySchema,
  /** Grams. Only consulted by weight-banded shipping rates. */
  weightGrams: z.number().int().min(0).max(1_000_000).default(0),
  /** The selected value per axis, in the same order as `options` below. */
  optionValues: z.array(z.string()).max(3).default([]),
});

export const productOptionInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(50),
  values: z.array(z.string().min(1).max(80)).min(1).max(50),
});

export const productInputSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(5000).default(""),
  bulletPoints: z.array(z.string().max(300)).max(20).default([]),
  seoTitle: z.string().max(70).nullable().default(null),
  seoDescription: z.string().max(160).nullable().default(null),
  /** Null uses the store's default tax code. */
  taxCode: taxCodeSchema.nullable().default(null),
  variants: z.array(variantInputSchema).min(1).max(50),
  /** Up to three priced axes — Size × Colour. `variantName` derives from this. */
  options: z.array(productOptionInputSchema).max(3).default([]),
  optionGroups: z.array(optionGroupSchema).max(10).default([]),
  isLive: z.boolean().default(false),
});

export const collectionInputSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(200),
  productIds: z.array(z.string()).max(500).default([]),
});

/**
 * A store page.
 *
 * The slug check is here rather than in the route so both sides of the wire
 * enforce it: the editor can say why before a save is attempted, and the API
 * still refuses if something else asks. The message names the route it would
 * collide with, because "invalid slug" tells a merchant nothing they can act on.
 */
export const pageInputSchema = z.object({
  slug: slugSchema.superRefine((value, ctx) => {
    const owner = RESERVED_PAGE_SLUGS[value];
    if (owner) {
      ctx.addIssue({
        code: "custom",
        message: `/${value} is already ${owner}. Choose a different address.`,
      });
    }
  }),
  title: z.string().min(1).max(200),
  /** Markdown, not HTML. Rendered and sanitised server-side on the way out. */
  body: z.string().max(100_000).default(""),
  isLive: z.boolean().default(false),
  inNav: z.boolean().default(false),
});

/** Just the body: the preview endpoint renders it and stores nothing. */
export const pagePreviewInputSchema = z.object({
  body: z.string().max(100_000).default(""),
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
  /**
   * Tax. Off unless the merchant has said otherwise — see the Settings copy,
   * which is most of this feature: Stripe Tax is a paid add-on, the
   * registrations are the merchant's to create, and Beluga files nothing.
   */
  taxEnabled: z.boolean().default(false),
  taxBehavior: taxBehaviorSchema.default("exclusive"),
  defaultTaxCode: taxCodeSchema.default("txcd_99999999"),
  theme: themeSchema,
});

export const loginInputSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(400),
});

/**
 * First-run setup.
 *
 * A password minimum lands here rather than on `loginInputSchema`: existing
 * accounts must still be able to sign in with whatever they already have, but
 * nothing new should be created below this bar. v1's initial-config modal was
 * two fields with no minimum at all.
 */
export const setupInputSchema = z.object({
  storeName: z.string().min(1).max(120),
  currency: z.string().length(3).default("USD"),
  email: z.string().email().max(320),
  password: z.string().min(12, "Use at least 12 characters.").max(400),
  stripePublishableKey: z
    .string()
    .startsWith("pk_", "That looks like a secret key. Only the publishable key belongs here.")
    .nullable()
    .default(null),
  theme: themeSchema,
  /** Load the demo catalogue so the storefront has something to render. */
  seedDemo: z.boolean().default(false),
});

/**
 * What the setup wizard is allowed to know before anyone has authenticated.
 *
 * Detail is only returned while the store is unconfigured — which is
 * unavoidably public, since that is the state the wizard exists to resolve.
 * Once setup completes this collapses to `needsSetup: false` and nothing else.
 */
export const setupStatusSchema = z.object({
  needsSetup: z.boolean(),
  hasAdmin: z.boolean().optional(),
  hasSettings: z.boolean().optional(),
  /** Whether the *server* has a secret key. The key itself never leaves it. */
  hasStripeSecret: z.boolean().optional(),
  stripeMode: z.enum(["test", "live"]).nullable().optional(),
});

/** Server-side wiring, shown on the admin dashboard. Booleans, never values. */
export const environmentStatusSchema = z.object({
  hasStripeSecret: z.boolean(),
  stripeMode: z.enum(["test", "live"]).nullable(),
  hasWebhookSecret: z.boolean(),
  hasEmail: z.boolean(),
  database: z.enum(["sqlite", "postgres"]),
  publicUrl: z.string(),
});

/**
 * The shipping table, saved as one document.
 *
 * Zones and rates travel together because they are edited together: a rate can
 * reference a zone created in the same save.
 */
export const shippingTableInputSchema = z.object({
  zones: z.array(shippingZoneInputSchema.extend({ id: z.string().optional() })).max(50),
  rates: z.array(shippingRateInputSchema.extend({ id: z.string().optional() })).max(200),
});

/** What the cart page asks for: identifiers and a destination, never prices. */
export const shippingQuoteInputSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().min(1),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .max(100),
  countryCode: countryCodeSchema,
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

/** Alt text is editable after upload: a11y should not depend on getting it
 * right in the moment a file is dropped. */
export const imageAltInputSchema = z.object({
  path: z.string().min(1).max(512),
  alt: z.string().max(300),
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
export type ProductOptionInput = z.infer<typeof productOptionInputSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type CollectionInput = z.infer<typeof collectionInputSchema>;
export type PageInput = z.infer<typeof pageInputSchema>;
export type SettingsInput = z.infer<typeof settingsInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type ShippingTableInput = z.infer<typeof shippingTableInputSchema>;
export type ShippingQuoteInput = z.infer<typeof shippingQuoteInputSchema>;
export type SetupInput = z.infer<typeof setupInputSchema>;
export type SetupStatus = z.infer<typeof setupStatusSchema>;
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>;
export type ProductQuery = z.infer<typeof productQuerySchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type ProductPageResponse = z.infer<typeof productPageResponseSchema>;

/**
 * Administrators, as the client is allowed to see them.
 *
 * There is no `passwordHash` here and there must never be one. v1 kept its hash
 * in a `config.env` that the server handed to the browser.
 */
export const adminRoleSchema = z.enum(["owner", "staff"]);

export interface AdminSummary {
  id: string;
  email: string;
  role: z.infer<typeof adminRoleSchema>;
  lastLoginAt: number | null;
  createdAt: number;
  /** True for the account making the request, which cannot remove itself. */
  isSelf: boolean;
}

export const inviteInputSchema = z.object({
  email: z.string().email("That does not look like an email address.").max(320),
  role: adminRoleSchema.default("staff"),
});

export const acceptInviteInputSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(12, "Use at least 12 characters.")
    .max(200),
});

export const passwordChangeInputSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(12, "Use at least 12 characters.").max(200),
});

export type AdminRole = z.infer<typeof adminRoleSchema>;
export type InviteInput = z.infer<typeof inviteInputSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteInputSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeInputSchema>;
