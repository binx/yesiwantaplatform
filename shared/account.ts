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
 * A saved recipient: the same shape a postcard is addressed with, so what a
 * customer saves is exactly what the designer can pick up again — plus what
 * makes a list into an address book: a label, tags for one-click groups, a
 * birthday, notes.
 */
const addressBookFields = {
  /** "Mom", "the Okafors". Shown in the book; the card prints `name`. */
  label: z.string().trim().max(80).nullable().default(null),
  /** Lowercase, short, at most ten. `holiday`, `family`. */
  tags: z.array(z.string().trim().toLowerCase().min(1).max(24)).max(10).default([]),
  /** MM-DD, or YYYY-MM-DD when the year is known. */
  birthday: z
    .string()
    .trim()
    .regex(/^(\d{4}-)?\d{2}-\d{2}$/, "Use a date like 10-14, or 1985-10-14.")
    .nullable()
    .default(null),
  notes: z.string().trim().max(500).nullable().default(null),
};

export const addressInputSchema = recipientFieldsSchema
  .extend(addressBookFields)
  .superRefine(refineRecipient)
  .transform(normaliseRecipient);

export const addressSourceSchema = z.enum(["order", "manual", "request"]);

export const customerAddressSchema = recipientFieldsSchema
  .extend(addressBookFields)
  .extend({
    id: z.string(),
    /** When Lob's verification last called it deliverable; the designer skips re-checking these. */
    verifiedAt: z.number().int().nullable().default(null),
    /** How it arrived: a paid order, typed by hand, or a request link. */
    source: addressSourceSchema.default("order"),
    /** The most recent paid order that mailed here, epoch milliseconds. */
    lastSentAt: z.number().int().nullable().default(null),
  })
  .superRefine(refineRecipient)
  .transform(normaliseRecipient);

/* ------------------------------------------------------- address requests */

/**
 * "Send me your address": a link the customer hands to a friend, who fills
 * in one address that lands in the customer's book. A single link takes one
 * response; a collector link takes many, for a whole holiday list.
 */
export const addressRequestInputSchema = z.object({
  /** Who it is for ("Maya"), or what it is for ("Holiday card 2026"). */
  label: z.string().trim().min(1, "Say who this is for.").max(80),
  multi: z.boolean().default(false),
  /** Email the requester — never the responder — when an address arrives. */
  notifyByEmail: z.boolean().default(true),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});

export const addressRequestStatusSchema = z.enum(["open", "fulfilled", "revoked", "expired"]);

/** A request as its owner sees it, link included. */
export const addressRequestSchema = z.object({
  id: z.string(),
  label: z.string(),
  multi: z.boolean(),
  status: addressRequestStatusSchema,
  notifyByEmail: z.boolean(),
  responses: z.number().int(),
  url: z.string(),
  expiresAt: z.number().int(),
  createdAt: z.number().int(),
});

/** What the responder is shown. Nothing about the requester but a first name. */
export const addressRequestPublicSchema = z.object({
  requesterName: z.string(),
  /** The collector's purpose, so the responder has context. Null for a single link: its label is their own name. */
  label: z.string().nullable(),
  multi: z.boolean(),
  status: addressRequestStatusSchema,
});

export const addressRequestResponseSchema = recipientSchema;

export type AddressRequestInput = z.infer<typeof addressRequestInputSchema>;
export type AddressRequestStatus = z.infer<typeof addressRequestStatusSchema>;
export type AddressRequest = z.infer<typeof addressRequestSchema>;
export type AddressRequestPublic = z.infer<typeof addressRequestPublicSchema>;

/** A customer, as the client is allowed to see it. No hashes, no tokens. */
export const customerProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  emailVerified: z.boolean(),
  createdAt: z.number().int(),
  /** Replies: the name a recipient is shown, and where a reply is mailed. Null when replies are off. */
  replyDisplayName: z.string().nullable().default(null),
  replyAddress: recipientSchema.nullable().default(null),
});

/** Turn replies on: a name to show and an address to mail to. */
export const replySettingsInputSchema = z.object({
  displayName: z.string().trim().min(1, "A name is required.").max(40, "40 characters at most."),
  address: recipientSchema,
});
export type ReplySettingsInput = z.infer<typeof replySettingsInputSchema>;

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
export type AddressSource = z.infer<typeof addressSourceSchema>;
