import { z } from "zod";
import {
  centsSchema,
  localeSchema,
  RESERVED_PAGE_SLUGS,
  slugSchema,
  storeSchema,
  themeSchema,
  heroSchema,
  defaultHero,
} from "./schema.js";
import { cropSchema, defaultCrop, orientationSchema, postcardBackSchema, recipientSchema } from "./postcards.js";

/**
 * Request and response contracts, validated on both sides of the wire.
 *
 * Note what is absent: no request carries a price for something being bought.
 * The postcard's price is read from settings by the checkout route.
 */

/**
 * A store page.
 *
 * The slug check is here rather than in the route so both sides of the wire
 * enforce it; the message names the route it would collide with.
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
  locale: localeSchema.default("en-US"),
  /** Publishable key only; a secret key here is rejected outright. */
  stripePublishableKey: z
    .string()
    .startsWith("pk_", "That looks like a secret key. Only the publishable key belongs here.")
    .nullable()
    .default(null),
  /** The price of one postcard. Stripe's floor for a charge is 50 cents. */
  postcardPriceCents: centsSchema.min(50, "Stripe cannot charge less than 50 cents."),
  /** The price of one postcard mailed abroad. Null keeps the shop US-only. */
  internationalPostcardPriceCents: centsSchema.min(50, "Stripe cannot charge less than 50 cents.").nullable().default(null),
  /**
   * The shop's own US address. Lob requires one on every international
   * piece — it is printed as the return address — so international mail
   * cannot be turned on without it.
   */
  returnAddress: recipientSchema
    .refine((address) => address.country === "US", "The return address must be in the United States.")
    .nullable()
    .default(null),
  hero: heroSchema.default(defaultHero),
  cartRecoveryEnabled: z.boolean().default(false),
  cartRecoveryDelayHours: z.number().int().min(1).max(168).default(4),
  theme: themeSchema,
});

export const adminEmailSchema = z.string().email().max(320);

export const loginInputSchema = z.object({
  email: adminEmailSchema,
  password: z.string().min(1).max(400),
});

/**
 * First-run setup. A password minimum lands here rather than on
 * `loginInputSchema`: existing accounts must still be able to sign in.
 */
export const setupInputSchema = z.object({
  storeName: z.string().min(1).max(120),
  currency: z.string().length(3).default("USD"),
  email: adminEmailSchema,
  password: z.string().min(12, "Use at least 12 characters.").max(400),
  stripePublishableKey: z
    .string()
    .startsWith("pk_", "That looks like a secret key. Only the publishable key belongs here.")
    .nullable()
    .default(null),
  theme: themeSchema,
  /** The token the server printed at boot, required whenever `GET /setup` reports `requiresToken`. */
  setupToken: z.string().max(200).optional(),
});

export const setupStatusSchema = z.object({
  needsSetup: z.boolean(),
  hasAdmin: z.boolean().optional(),
  hasSettings: z.boolean().optional(),
  hasStripeSecret: z.boolean().optional(),
  stripeMode: z.enum(["test", "live"]).nullable().optional(),
  stripeKeyStatus: z.enum(["valid", "invalid", "unchecked"]).optional(),
  requiresToken: z.boolean().optional(),
  publicUrl: z.string().optional(),
});

/** Server-side wiring, shown on the admin dashboard. Booleans, never values. */
export const environmentStatusSchema = z.object({
  hasStripeSecret: z.boolean(),
  stripeMode: z.enum(["test", "live"]).nullable(),
  stripeKeyStatus: z.enum(["valid", "invalid", "unchecked"]),
  hasWebhookSecret: z.boolean(),
  hasEmail: z.boolean(),
  /** Whether a Lob API key is on the server, and which environment it is for. */
  hasLob: z.boolean(),
  lobMode: z.enum(["test", "live"]).nullable(),
  database: z.enum(["sqlite", "postgres"]),
  publicUrl: z.string(),
  production: z.boolean(),
});

/** What the "send a test email" and "send a test postcard" buttons get back. */
export const emailTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

export const lobTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  /** Lob's own proof of the rendered card, when it accepted one. */
  url: z.string().nullable().default(null),
});

export const imageInputSchema = z.object({
  alt: z.string().max(300).default(""),
});

export const reorderInputSchema = z.object({
  ids: z.array(z.string().min(1)).max(1000),
});

/** What the designer posts alongside the front image. */
export const designInputSchema = z.object({
  orientation: orientationSchema,
  back: postcardBackSchema,
  crop: cropSchema.default(defaultCrop),
});

export const storeResponseSchema = storeSchema;

export const sessionResponseSchema = z.object({
  isAdmin: z.boolean(),
  csrfToken: z.string(),
  /** False until settings and an admin user exist. */
  isConfigured: z.boolean(),
});

export const passwordChangeInputSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(12, "Use at least 12 characters.").max(200),
});

export const forgotPasswordInputSchema = z.object({
  email: adminEmailSchema,
});

export const resetPasswordInputSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12, "Use at least 12 characters.").max(400),
});

export type PageInput = z.infer<typeof pageInputSchema>;
export type SettingsInput = z.infer<typeof settingsInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type SetupInput = z.infer<typeof setupInputSchema>;
export type SetupStatus = z.infer<typeof setupStatusSchema>;
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>;
export type EmailTestResult = z.infer<typeof emailTestResultSchema>;
export type LobTestResult = z.infer<typeof lobTestResultSchema>;
export type DesignInput = z.infer<typeof designInputSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeInputSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;
