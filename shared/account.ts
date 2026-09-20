import { z } from "zod";
import { recipientSchema } from "./postcards.js";

/**
 * Customer accounts.
 *
 * Everyone on the platform signs in the same way — a subscriber, an artist,
 * someone who is both — and this is that surface. It is public and
 * unauthenticated-facing, so every input here is validated as carefully as
 * the admin login is.
 */

/** Same bar as `setupInputSchema` in shared/api.ts. */
const NEW_PASSWORD_MIN = 12;

/**
 * A same-site path: exactly one leading slash, so `//evil.example` (a
 * protocol-relative URL a browser will follow off-site) is rejected along
 * with any absolute URL.
 */
export function isSameSitePath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

export const customerRegisterInputSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(NEW_PASSWORD_MIN, "Use at least 12 characters.").max(400),
  name: z.string().trim().max(200).nullable().default(null),
  /**
   * Where to send the person after they verify — the artist page they came
   * from, or the studio. Dropped rather than rejected when it isn't a
   * same-site path, the same fallback `AccountLoginPage` uses for `from`.
   */
  next: z
    .string()
    .max(2048)
    .nullable()
    .default(null)
    .transform((value) => (value && isSameSitePath(value) ? value : null)),
});

export const customerLoginInputSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(400),
});

export const customerProfileUpdateInputSchema = z.object({
  name: z.string().trim().max(200).nullable().default(null),
});

/** Where this person's postcards are mailed. One address per account. */
export const mailingAddressInputSchema = recipientSchema;

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

/** A customer, as the client is allowed to see it. No hashes, no tokens. */
export const customerProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  emailVerified: z.boolean(),
  createdAt: z.number().int(),
  /** Where their cards go. Null until they set one, which subscribing asks for. */
  address: recipientSchema.nullable().default(null),
  /** Set once this person has an artist page — the studio is theirs. */
  artistSlug: z.string().nullable().default(null),
});

/** Who is signed in, if anyone. Answers 200 either way. */
export const customerSessionSchema = z.object({
  customer: customerProfileSchema.nullable(),
});

export type CustomerSession = z.infer<typeof customerSessionSchema>;
export type CustomerRegisterInput = z.infer<typeof customerRegisterInputSchema>;
export type CustomerLoginInput = z.infer<typeof customerLoginInputSchema>;
export type CustomerProfileUpdateInput = z.infer<typeof customerProfileUpdateInputSchema>;
export type MailingAddressInput = z.infer<typeof mailingAddressInputSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailInputSchema>;
export type CustomerProfile = z.infer<typeof customerProfileSchema>;
