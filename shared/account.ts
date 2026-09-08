import { z } from "zod";

/**
 * Storefront customer accounts.
 *
 * Distinct from `shared/api.ts`'s admin schemas: this is a public,
 * unauthenticated-facing surface, so every input here is validated as
 * carefully as the admin login is — see `docs/tasks/11-customer-accounts.md`
 * for the posture this is held to.
 */

/**
 * Same bar as `setupInputSchema` in shared/api.ts — reused rather than
 * reinvented, per the brief. Existing accounts (there are none yet, but the
 * pattern matches admin login) are never re-checked against this at sign-in.
 */
const NEW_PASSWORD_MIN = 12;

export const customerRegisterInputSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(NEW_PASSWORD_MIN, "Use at least 12 characters.").max(400),
  name: z.string().max(200).nullable().default(null),
});

export const customerLoginInputSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(400),
});

export const customerProfileUpdateInputSchema = z.object({
  name: z.string().max(200).nullable().default(null),
});

export const forgotPasswordInputSchema = z.object({
  email: z.string().email().max(320),
});

export const resetPasswordInputSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(NEW_PASSWORD_MIN, "Use at least 12 characters.").max(400),
});

export const verifyEmailInputSchema = z.object({
  token: z.string().min(1),
});

/** Two-letter ISO 3166-1 alpha-2. Case-folded rather than rejected, since a
 * buyer's keyboard is not the place to enforce that. */
const addressCountrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "must be a two-letter country code, like US or GB");

export const addressInputSchema = z.object({
  name: z.string().max(200).nullable().default(null),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).nullable().default(null),
  city: z.string().max(120).nullable().default(null),
  state: z.string().max(120).nullable().default(null),
  postalCode: z.string().max(30).nullable().default(null),
  country: addressCountrySchema,
  isDefault: z.boolean().default(false),
});

export const customerAddressSchema = addressInputSchema.extend({
  id: z.string(),
});

/**
 * A customer, as the client is allowed to see it.
 *
 * No `passwordHash`, no token columns — the same discipline as
 * `AdminSummary` in shared/api.ts, for the same reason.
 */
export const customerProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  emailVerified: z.boolean(),
  createdAt: z.number().int(),
});

export type CustomerRegisterInput = z.infer<typeof customerRegisterInputSchema>;
export type CustomerLoginInput = z.infer<typeof customerLoginInputSchema>;
export type CustomerProfileUpdateInput = z.infer<typeof customerProfileUpdateInputSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailInputSchema>;
export type AddressInput = z.infer<typeof addressInputSchema>;
export type CustomerAddress = z.infer<typeof customerAddressSchema>;
export type CustomerProfile = z.infer<typeof customerProfileSchema>;
