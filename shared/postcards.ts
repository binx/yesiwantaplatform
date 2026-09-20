import { z } from "zod";
import { imageSchema } from "./schema.js";
import { countryName, isCountryCode } from "./countries.js";
import { US_STATE_CODES } from "./us-states.js";

/**
 * The postcard itself — everything the site, the API and the print pipeline
 * have to agree on about what a postcard is.
 *
 * The numbers here are Lob's, not ours. A 4×6 postcard is printed from a
 * 6.25″ × 4.25″ file at 300 dpi — the extra quarter inch is bleed that the
 * trimmer takes off — which is 1875 × 1275 pixels. They are written once and
 * imported by the uploader that makes the print file, the page that previews
 * it, and the module that sends it.
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

/**
 * Where the photo sits inside the card, as fractions of the overflow.
 *
 * `x` and `y` are 0..1: 0.5 is the centre crop, 0 pins the photo's left/top
 * edge to the card's, 1 its right/bottom. `zoom` scales the photo up from the
 * smallest size that covers the card. The same three numbers drive the
 * preview and the print file, which is what keeps them the same picture.
 */
export const cropSchema = z.object({
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.5),
  zoom: z.number().min(1).max(3).default(1),
});
export type Crop = z.infer<typeof cropSchema>;
export const defaultCrop: Crop = { x: 0.5, y: 0.5, zoom: 1 };

export interface CropRect {
  /** How much the source is enlarged (or shrunk) to fill the target at this zoom. */
  scale: number;
  /** The scaled source's width and height. */
  scaledWidth: number;
  scaledHeight: number;
  /** The target's window into the scaled source, in scaled pixels. */
  left: number;
  top: number;
}

/**
 * The rectangle of a `source`-sized image that fills a `target` at this crop.
 *
 * Pure, so the browser and sharp call the same function: the preview draws
 * the photo at `scale` translated by `(-left, -top)`, and the print pipeline
 * resizes to the scaled size and extracts the same window.
 */
export function cropRect(
  source: { width: number; height: number },
  target: { width: number; height: number },
  crop: Crop,
): CropRect {
  const cover = Math.max(target.width / source.width, target.height / source.height);
  const scale = cover * crop.zoom;
  const scaledWidth = source.width * scale;
  const scaledHeight = source.height * scale;
  return {
    scale,
    scaledWidth,
    scaledHeight,
    left: Math.max(0, scaledWidth - target.width) * crop.x,
    top: Math.max(0, scaledHeight - target.height) * crop.y,
  };
}

/** The faces the back of a card can be set in. All three load from Google Fonts. */
export const BACK_FONTS = [
  { name: "Patrick Hand", label: "Handwriting" },
  { name: "Sacramento", label: "Script" },
  { name: "Quicksand", label: "Modern" },
] as const;

/**
 * Where `BACK_FONTS` load from — always, regardless of the platform's own
 * theme font. `print/back.hbs` and the site shell both build their `<link>`
 * from this constant rather than duplicating the string.
 */
export const CARD_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Sacramento&family=Quicksand:wght@400;600&display=swap";

/** The origins `CARD_FONTS_URL` needs: the stylesheet host and the one its `@font-face`s point at. */
export const CARD_FONTS_ORIGINS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] as const;

/** The id on the card fonts' `<link>`, so a server-rendered shell and a static one can recognise each other's copy. */
export const CARD_FONTS_LINK_ID = "yiwap-card-fonts";

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
 * the money has been taken — so it is refused here first, while the
 * subscriber is still looking at the field.
 *
 * A US address needs a two-letter state and a five-digit ZIP. Anywhere else
 * the state and postal code are whatever the country uses, and either may be
 * empty; the country is an ISO 3166-1 alpha-2 code, which is what Lob's
 * `address_country` takes.
 */
export const recipientFieldsSchema = z.object({
  name: z.string().trim().min(1, "A name is required.").max(40, "40 characters at most."),
  line1: z.string().trim().min(1, "A street address is required.").max(64, "64 characters at most."),
  line2: z.string().trim().max(64, "64 characters at most.").nullable().default(null),
  city: z.string().trim().min(1, "A city is required.").max(200),
  state: z.string().trim().max(64, "64 characters at most.").default(""),
  postalCode: z.string().trim().max(20, "20 characters at most.").default(""),
  country: z.string().trim().toUpperCase().default("US"),
});

type RecipientFields = z.infer<typeof recipientFieldsSchema>;

export function refineRecipient(recipient: RecipientFields, ctx: z.RefinementCtx): void {
  if (!isCountryCode(recipient.country)) {
    ctx.addIssue({ code: "custom", path: ["country"], message: "Use a two-letter country code, like CA." });
  }
  if (recipient.country !== "US") return;
  if (!US_STATE_CODES.has(recipient.state.toUpperCase())) {
    ctx.addIssue({ code: "custom", path: ["state"], message: "Choose a state." });
  }
  if (!/^\d{5}(-\d{4})?$/.test(recipient.postalCode)) {
    ctx.addIssue({ code: "custom", path: ["postalCode"], message: "Use a 5-digit ZIP code." });
  }
}

/** A US state is stored in capitals, as it prints; elsewhere the subscriber's own spelling stands. */
export function normaliseRecipient<T extends RecipientFields>(recipient: T): T {
  return recipient.country === "US" ? { ...recipient, state: recipient.state.toUpperCase() } : recipient;
}

export const recipientSchema = recipientFieldsSchema.superRefine(refineRecipient).transform(normaliseRecipient);

export type Recipient = z.infer<typeof recipientSchema>;

/**
 * What Lob's address verification said about a recipient.
 *
 * Lob's own sub-codes (`undeliverable_no_match` and friends) collapse to
 * `undeliverable`; `unknown` means Lob could not be asked — no key, an
 * outage — and the subscriber proceeds as if nothing had been checked.
 */
export const deliverabilitySchema = z.enum([
  "deliverable",
  "deliverable_unnecessary_unit",
  "deliverable_incorrect_unit",
  "deliverable_missing_unit",
  "undeliverable",
  "unknown",
]);
export type Deliverability = z.infer<typeof deliverabilitySchema>;

export const verificationSchema = z.object({
  deliverability: deliverabilitySchema,
  /** The address in USPS's form, when Lob returned one. Null when undeliverable or unknown. */
  suggested: recipientSchema.nullable(),
  /** Whether `suggested` differs from what was sent, ignoring case, punctuation and ZIP+4. */
  changed: z.boolean(),
});
export type Verification = z.infer<typeof verificationSchema>;

export const unknownVerification: Verification = { deliverability: "unknown", suggested: null, changed: false };

/** A calendar day, YYYY-MM-DD. The day the card goes to Lob, in the platform's day. */
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

/** A design as the site receives it — no file paths, just what it can show. */
export const postcardDesignSchema = z.object({
  id: z.string().min(1),
  orientation: orientationSchema,
  thumbnail: imageSchema,
  back: postcardBackSchema,
  createdAt: z.number().int(),
});

export type PostcardDesign = z.infer<typeof postcardDesignSchema>;

/**
 * Where one physical card is.
 *
 *   scheduled  written for a subscriber; waiting for the print sweep
 *   sending    claimed by the sweep — a second instance skips it
 *   sent       accepted by Lob; `lobId` is theirs
 *   error      Lob refused it; `lastError` says why, in Lob's own words
 *   cancelled  withdrawn before it went out
 */
export const postcardStatusSchema = z.enum(["scheduled", "sending", "sent", "error", "cancelled"]);

export type PostcardStatus = z.infer<typeof postcardStatusSchema>;

/**
 * Lob's tracking events, in the order they happen. Only the ones a person
 * would want to hear about are shown; the rest (`created`, `rendered_pdf`,
 * `mailed`) are stored and kept quiet. "Processed for delivery" means the
 * card is at the recipient's post office and arrives within a business
 * day; "delivered" follows when USPS reports it.
 */
export const SHOWN_TRACKING_EVENTS = [
  "postcard.international_exit",
  "postcard.in_transit",
  "postcard.in_local_area",
  "postcard.processed_for_delivery",
  "postcard.re-routed",
  "postcard.returned_to_sender",
  "postcard.delivered",
] as const;

export type ShownTrackingEvent = (typeof SHOWN_TRACKING_EVENTS)[number];

/**
 * The one tracking type anything branches on: it writes the admin's error
 * column. Named once so the webhook, the query and the chip cannot drift
 * apart on a spelling.
 */
export const RETURNED_TO_SENDER = "postcard.returned_to_sender";

export function isShownTrackingEvent(type: string): type is ShownTrackingEvent {
  return (SHOWN_TRACKING_EVENTS as readonly string[]).includes(type);
}

export const trackingEventSchema = z.object({
  /** Lob's `event_type.id`, verbatim. */
  type: z.string(),
  /** Epoch milliseconds. */
  occurredAt: z.number().int(),
  location: z.string().nullable(),
});

export type TrackingEvent = z.infer<typeof trackingEventSchema>;

/**
 * One physical postcard: a mailing's design, going to one subscriber.
 *
 * `lastError` is Lob's own words and is here for the admin. The account and
 * studio routes strip it before anyone else sees the card.
 */
export const postcardSchema = z.object({
  id: z.string(),
  designId: z.string(),
  subscriptionId: z.string(),
  recipient: recipientSchema,
  mailDate: mailDateSchema,
  status: postcardStatusSchema,
  lobId: z.string().nullable(),
  lobUrl: z.string().nullable(),
  expectedDeliveryDate: z.string().nullable(),
  sentAt: z.number().int().nullable(),
  attempts: z.number().int().min(0),
  lastError: z.string().nullable(),
  /** The latest shown tracking event, or null before the first scan. */
  trackingStatus: z.string().nullable().default(null),
  /** Every shown event so far, oldest first. */
  tracking: z.array(trackingEventSchema).default([]),
});

export type Postcard = z.infer<typeof postcardSchema>;

export function isInternational(recipient: Pick<Recipient, "country">): boolean {
  return recipient.country !== "US";
}

/** One line of a recipient's address, the way it is read aloud. Abroad, the country is named. */
export function formatRecipient(recipient: Recipient, locale = "en"): string {
  const street = recipient.line2 ? `${recipient.line1}, ${recipient.line2}` : recipient.line1;
  const region = [recipient.state, recipient.postalCode].filter(Boolean).join(" ");
  const local = region ? `${street}, ${recipient.city}, ${region}` : `${street}, ${recipient.city}`;
  return isInternational(recipient) ? `${local}, ${countryName(recipient.country, locale)}` : local;
}

/**
 * Strip emoji and other pictographs.
 *
 * The three print faces have no glyphs for them, so Lob's renderer would draw
 * a box — and the preview on the site would draw the emoji, which is the
 * mismatch worth avoiding. The Unicode property class is what a hand-written
 * range list would be approximating.
 */
export function stripEmoji(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "");
}
