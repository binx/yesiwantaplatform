import { z } from "zod";
import { normaliseRecipient, recipientFieldsSchema, recipientSchema, refineRecipient } from "./postcards.js";

/**
 * Storefront customer accounts.
 *
 * A public, unauthenticated-facing surface, so every input here is validated
 * as carefully as the admin login is.
 */

/** Same bar as `setupInputSchema` in shared/api.ts. */
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

/**
 * A saved recipient. The same shape a postcard is addressed with, so what a
 * customer saves is exactly what the designer can pick up again.
 */
export const addressInputSchema = recipientSchema;

export const customerAddressSchema = recipientFieldsSchema
  .extend({
    id: z.string(),
    /** When Lob's verification last called it deliverable; the designer skips re-checking these. */
    verifiedAt: z.number().int().nullable().default(null),
  })
  .superRefine(refineRecipient)
  .transform(normaliseRecipient);

/** A customer, as the client is allowed to see it. No hashes, no tokens. */
export const customerProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  emailVerified: z.boolean(),
  createdAt: z.number().int(),
});

/** Who is signed in, if anyone. Answers 200 either way. */
export const customerSessionSchema = z.object({
  customer: customerProfileSchema.nullable(),
});

export type CustomerSession = z.infer<typeof customerSessionSchema>;
export type CustomerRegisterInput = z.infer<typeof customerRegisterInputSchema>;
export type CustomerLoginInput = z.infer<typeof customerLoginInputSchema>;
export type CustomerProfileUpdateInput = z.infer<typeof customerProfileUpdateInputSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailInputSchema>;
export type AddressInput = z.infer<typeof addressInputSchema>;
export type CustomerAddress = z.infer<typeof customerAddressSchema>;
export type CustomerProfile = z.infer<typeof customerProfileSchema>;
