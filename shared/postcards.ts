import { z } from "zod";
import { imageSchema } from "./schema.js";

/**
 * The postcard itself — everything the storefront, the API and the print
 * pipeline have to agree on about what a postcard is.
 *
 * The numbers here are Lob's, not ours. A 4×6 postcard is printed from a
 * 6.25″ × 4.25″ file at 300 dpi — the extra quarter inch is bleed that the
 * trimmer takes off — which is 1875 × 1275 pixels. v1 hard-coded the same two
 * sizes in three places; here they are written once and imported by the
 * uploader that makes the print file, the page that previews it, and the
 * module that sends it.
 */

export const orientationSchema = z.enum(["portrait", "landscape"]);
export type Orientation = z.infer<typeof orientationSchema>;

/** Pixels at 300 dpi, bleed included. */
export const PRINT_SIZES: Record<Orientation, { width: number; height: number }> = {
  portrait: { width: 1275, height: 1875 },
  landscape: { width: 1875, height: 1275 },
};

/**
 * Inches of the printed card, and of the safe area inside it.
 *
 * Lob trims 1/8″ off each edge, and anything within another 1/8″ of the cut
 * risks being clipped — so the preview draws a frame at the safe area and the
 * upload note says "at least" the print size rather than "exactly".
 */
export const BLEED_INCHES = 0.125;
export const SAFE_INCHES = 0.125;

/** The faces the back of a card can be set in. All three load from Google Fonts. */
export const BACK_FONTS = [
  { name: "Patrick Hand", label: "Handwriting" },
  { name: "Sacramento", label: "Script" },
  { name: "Quicksand", label: "Modern" },
] as const;

export const backFontSchema = z.enum(
  BACK_FONTS.map((font) => font.name) as [string, ...string[]],
);

/** What is printed on the back, beside the address. */
export const postcardBackSchema = z.object({
  /** The message. Emoji are stripped at render time — the print fonts have none. */
  text: z.string().max(600).default(""),
  /** A closing line, set flush right: "Love, Rachel". */
  valediction: z.string().max(80).default(""),
  fontName: backFontSchema.default("Patrick Hand"),
  fontSize: z.number().int().min(12).max(32).default(24),
  fontColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "must be a hex colour like #000000")
    .default("#000000"),
});

export type PostcardBack = z.infer<typeof postcardBackSchema>;

export const defaultPostcardBack: PostcardBack = {
  text: "",
  valediction: "",
  fontName: "Patrick Hand",
  fontSize: 24,
  fontColor: "#000000",
};

/**
 * Who a postcard goes to.
 *
 * The limits are Lob's: 40 characters for a name and 64 for an address line
 * is what fits on the card, and a longer value is refused by their API after
 * the money has been taken — so it is refused here first, while the buyer is
 * still looking at the field. US only, because Lob's postcard product is.
 */
export const recipientSchema = z.object({
  name: z.string().trim().min(1, "A name is required.").max(40, "40 characters at most."),
  line1: z.string().trim().min(1, "A street address is required.").max(64, "64 characters at most."),
  line2: z.string().trim().max(64, "64 characters at most.").nullable().default(null),
  city: z.string().trim().min(1, "A city is required.").max(200),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use the two-letter state code, like CA."),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP code."),
});

export type Recipient = z.infer<typeof recipientSchema>;

/** A calendar day, YYYY-MM-DD. The day the card goes to Lob, in the store's day. */
export const mailDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-14.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "That is not a real date.");

/** Today, as YYYY-MM-DD in local time — the smallest mail date the site offers. */
export function todayIso(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `addDaysIso("2026-09-14", 7)` → `"2026-09-21"`. Pure calendar arithmetic, no time zone. */
export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** A design as the storefront receives it — no file paths, just what it can show. */
export const postcardDesignSchema = z.object({
  id: z.string().min(1),
  orientation: orientationSchema,
  thumbnail: imageSchema,
  back: postcardBackSchema,
  createdAt: z.number().int(),
});

export type PostcardDesign = z.infer<typeof postcardDesignSchema>;

export const postcardStatusSchema = z.enum([
  "pending",
  "scheduled",
  "sending",
  "sent",
  "error",
  "cancelled",
]);

export type PostcardStatus = z.infer<typeof postcardStatusSchema>;

/**
 * One physical card on an order.
 *
 * `lastError` is Lob's own words and is here for the admin. The account
 * route strips it before a buyer sees the order — see `toCustomerOrder`.
 */
export const postcardSchema = z.object({
  id: z.string(),
  designId: z.string(),
  batchIndex: z.number().int().min(0),
  recipient: recipientSchema,
  mailDate: mailDateSchema,
  status: postcardStatusSchema,
  lobId: z.string().nullable(),
  lobUrl: z.string().nullable(),
  expectedDeliveryDate: z.string().nullable(),
  sentAt: z.number().int().nullable(),
  attempts: z.number().int().min(0),
  lastError: z.string().nullable(),
});

export type Postcard = z.infer<typeof postcardSchema>;

/** One line of a recipient's address, the way it is read aloud. */
export function formatRecipient(recipient: Recipient): string {
  const street = recipient.line2 ? `${recipient.line1}, ${recipient.line2}` : recipient.line1;
  return `${street}, ${recipient.city}, ${recipient.state} ${recipient.postalCode}`;
}

/**
 * Strip emoji and other pictographs.
 *
 * The three print faces have no glyphs for them, so Lob's renderer would draw
 * a box — and the preview on the site would draw the emoji, which is the
 * mismatch worth avoiding. v1 did the same with a hand-written range list;
 * the Unicode property class is what that list was approximating.
 */
export function stripEmoji(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "");
}
