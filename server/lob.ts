import { readFile } from "node:fs/promises";
import path from "node:path";
import Handlebars from "handlebars";
import sharp from "sharp";
import { env, hasLob, lobMode } from "./env.js";
import {
  BACK_FONTS,
  PRINT_SIZES,
  cropRect,
  defaultCrop,
  recipientSchema,
  stripEmoji,
  unknownVerification,
  type Crop,
  type Deliverability,
  type Orientation,
  type PostcardBack,
  type Recipient,
  type Verification,
} from "../shared/postcards.js";

/**
 * Lob — the printer.
 *
 * Talked to over its REST API directly rather than through the `lob` npm
 * package v1 used, which is two major versions behind Lob's own TypeScript
 * SDK and hid the one thing this module has to get right: what Lob said when
 * it refused a card. v1 logged `err` and moved on, and the site never told
 * anyone why a postcard did not go out. Every refusal here comes back as a
 * `LobError` carrying Lob's message verbatim, which the fulfilment sweep
 * writes onto the postcard row and the admin shows next to a Retry button.
 *
 * Two things about the file that are easy to get wrong, and were:
 *
 *   - **The DPI is metadata.** A 4×6 card is 6.25in × 4.25in, and Lob works
 *     that out from the file's pixel size *and its declared density*. A PNG
 *     from a browser canvas carries no density, which Lob reads as 72 dpi and
 *     a 26-inch-wide image, and refuses. `printFile` writes 300 dpi into the
 *     PNG explicitly.
 *   - **The front is always landscape.** Lob's 4×6 front is 6.25 wide by 4.25
 *     tall. A portrait design is rotated a quarter turn into that frame here,
 *     so what reaches Lob is the same shape every time and the recipient
 *     simply turns the card.
 */

const API = "https://api.lob.com/v1";
const TIMEOUT_MS = 30_000;

/** The DPI Lob expects, and what the print file declares. */
export const PRINT_DPI = 300;

export class LobError extends Error {
  readonly status: number;
  /** Lob's own machine-readable code, when it sends one. */
  readonly code: string | null;
  /** Whether a later attempt could succeed: a rate limit or an outage, not a refusal. */
  readonly retryable: boolean;
  /**
   * Whether the failure is about Lob or the network rather than this card:
   * a rate limit, or no HTTP answer at all. The sweep stops on these rather
   * than walking every remaining card into the same wall.
   */
  readonly stall: boolean;
  /** What Lob's `Retry-After` header asked for, when it sent one. */
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, code: string | null, retryAfterMs: number | null = null) {
    super(message);
    this.name = "LobError";
    this.status = status;
    this.code = code;
    this.retryable = status === 429 || status >= 500 || status === 0;
    this.stall = status === 429 || status === 0;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * `Retry-After` as milliseconds: either a number of seconds or an HTTP date.
 * Null when absent or unreadable — the caller picks its own pause.
 */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

export class LobNotConfiguredError extends Error {
  constructor() {
    super("Lob is not configured. Set LOB_API_KEY to send postcards.");
    this.name = "LobNotConfiguredError";
  }
}

export interface LobPostcard {
  id: string;
  /** Lob's rendered proof. */
  url: string | null;
  expectedDeliveryDate: string | null;
  /** Which Lob environment made it — a live card costs money. */
  mode: "test" | "live";
}

export interface SendPostcardInput {
  /** Our postcard id: Lob's idempotency key, so a retried request cannot mail two. */
  id: string;
  to: Recipient;
  /** The print file, already at Lob's size and density. */
  front: Buffer;
  back: PostcardBack;
  /** Free text Lob shows in its dashboard. */
  description: string;
}

/* ----------------------------------------------------------------- the file */

/**
 * The card face, pre-rotation: the source cropped to the print size at `crop`.
 *
 * `cropRect` in shared/postcards.ts decides the window; the preview on the
 * site calls the same function with the same three numbers, so what the
 * buyer dragged into the frame is what prints. Resize-then-extract rather
 * than sharp's `fit: "cover"`, whose `position` only takes a gravity or a
 * strategy, never a fraction.
 *
 * One pipeline: sharp applies the EXIF `rotate` first whatever order the
 * calls are made in, and `extract` after `resize` acts on the resized image
 * — so the source's upright dimensions are what the rect is computed from.
 */
export async function cropToCard(source: Buffer, orientation: Orientation, crop: Crop = defaultCrop): Promise<Buffer> {
  const size = PRINT_SIZES[orientation];
  const meta = await sharp(source, { failOn: "error" }).metadata();
  if (!meta.width || !meta.height) throw new Error("Could not read the image dimensions.");

  // EXIF orientations 5–8 are the quarter turns; `rotate()` will swap the axes.
  const turned = (meta.orientation ?? 1) >= 5;
  const upright = turned ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };

  const rect = cropRect(upright, size, crop);
  const scaledWidth = Math.max(size.width, Math.round(rect.scaledWidth));
  const scaledHeight = Math.max(size.height, Math.round(rect.scaledHeight));
  const left = Math.min(Math.max(0, Math.round(rect.left)), scaledWidth - size.width);
  const top = Math.min(Math.max(0, Math.round(rect.top)), scaledHeight - size.height);

  return sharp(source, { failOn: "error" })
    .rotate() // honour EXIF orientation before measuring the window
    .resize(scaledWidth, scaledHeight)
    .extract({ left, top, width: size.width, height: size.height })
    // Onto white: a transparent PNG would otherwise print its transparency as
    // black, which is not what anyone who exported a cut-out meant.
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
}

/**
 * Finish a cropped card face into the file Lob receives: rotated to
 * landscape if it was portrait, and written as PNG with the density Lob
 * expects to find.
 */
export async function finishPrintFile(
  card: Buffer,
  orientation: Orientation,
): Promise<{ bytes: Buffer; width: number; height: number }> {
  // A quarter turn clockwise puts the top of a portrait card on the right
  // edge, which is how a landscape frame holds a portrait picture.
  const oriented = orientation === "portrait" ? sharp(card).rotate(90) : sharp(card);

  const bytes = await oriented
    .png({ compressionLevel: 6 })
    .withMetadata({ density: PRINT_DPI })
    .toBuffer();

  return { bytes, width: PRINT_SIZES.landscape.width, height: PRINT_SIZES.landscape.height };
}

/** Make the print-ready front from whatever the buyer uploaded: `cropToCard`, then `finishPrintFile`. */
export async function printFile(
  source: Buffer,
  orientation: Orientation,
  crop: Crop = defaultCrop,
): Promise<{ bytes: Buffer; width: number; height: number }> {
  return finishPrintFile(await cropToCard(source, orientation, crop), orientation);
}

/* ----------------------------------------------------------------- the back */

let backTemplate: Handlebars.TemplateDelegate | null = null;

/** The CSS stack for one of the three print faces. */
function fontStack(fontName: string): string {
  const known = BACK_FONTS.find((font) => font.name === fontName);
  const family = known ? known.name : "Patrick Hand";
  const generic = family === "Quicksand" ? "sans-serif" : "cursive";
  return `"${family}", ${generic}`;
}

/**
 * The back of the card as HTML, rendered from `print/back.hbs`.
 *
 * Handlebars escapes the message on the way in, so a buyer cannot put markup
 * on their own postcard — which is not a security problem so much as a
 * printing one, since a stray `<` would otherwise vanish from the card.
 */
export async function renderBack(back: PostcardBack): Promise<string> {
  backTemplate ??= Handlebars.compile(await readFile(path.resolve("print", "back.hbs"), "utf8"));

  return backTemplate({
    text: stripEmoji(back.text),
    valediction: stripEmoji(back.valediction),
    fontFamily: fontStack(back.fontName),
    // Points, not pixels: the site previews at `px` on a 6.25in-wide mock and
    // Lob renders at 300 dpi, and a point is the unit both agree on.
    fontSize: back.fontSize,
    fontColor: back.fontColor,
  });
}

/**
 * The merge variables v1's Lob template expected, under the same names, so a
 * store that sets LOB_BACK_TEMPLATE_ID to its old template keeps working.
 */
function mergeVariables(back: PostcardBack): Record<string, string> {
  return {
    postcard_text: stripEmoji(back.text),
    postcard_valediction: stripEmoji(back.valediction),
    font_name: back.fontName,
    font_size: String(back.fontSize),
    font_color: back.fontColor,
  };
}

/* ------------------------------------------------------------------ the API */

function authorization(): string {
  if (!env.LOB_API_KEY) throw new LobNotConfiguredError();
  // Basic auth with the key as the username and no password — Lob's scheme.
  return `Basic ${Buffer.from(`${env.LOB_API_KEY}:`).toString("base64")}`;
}

interface LobErrorBody {
  error?: { message?: string; status_code?: number; code?: string };
}

interface LobPostcardBody {
  id: string;
  url?: string;
  expected_delivery_date?: string;
}

/** Send a multipart request and turn Lob's answer into either a body or a `LobError`. */
async function post<T>(endpoint: string, form: FormData, idempotencyKey?: string): Promise<T> {
  return send<T>(endpoint, {
    headers: { ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    body: form,
  });
}

/** The same, with a JSON body — what the verification endpoints take. */
async function postJson<T>(endpoint: string, body: unknown): Promise<T> {
  return send<T>(endpoint, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function send<T>(endpoint: string, init: { headers: Record<string, string>; body: FormData | string }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${endpoint}`, {
      method: "POST",
      headers: { authorization: authorization(), ...init.headers },
      body: init.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // No HTTP status at all: DNS, a timeout, a dropped socket. Retryable.
    throw new LobError(
      `Could not reach Lob: ${error instanceof Error ? error.message : String(error)}`,
      0,
      null,
    );
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail = (body as LobErrorBody | null)?.error;
    const message =
      detail?.message ?? (text ? text.slice(0, 300) : `Lob answered ${response.status} with no body.`);
    throw new LobError(
      `Lob refused it (${response.status}): ${message}`,
      response.status,
      detail?.code ?? null,
      retryAfterMs(response.headers.get("retry-after")),
    );
  }

  return body as T;
}

/**
 * Create one postcard at Lob.
 *
 * The front goes up as a file rather than a URL. v1 handed Lob a public URL
 * on postcardgifts.com and had to keep the image reachable there until Lob
 * fetched it; a file in the request has no such window, and works under a
 * bucket driver or on a laptop equally.
 */
export async function sendPostcard(input: SendPostcardInput): Promise<LobPostcard> {
  if (!hasLob || !lobMode) throw new LobNotConfiguredError();

  const form = new FormData();
  form.append("description", input.description.slice(0, 255));
  form.append("to[name]", input.to.name);
  form.append("to[address_line1]", input.to.line1);
  if (input.to.line2) form.append("to[address_line2]", input.to.line2);
  form.append("to[address_city]", input.to.city);
  form.append("to[address_state]", input.to.state);
  form.append("to[address_zip]", input.to.postalCode);
  form.append("to[address_country]", "US");
  form.append("size", "4x6");
  form.append("mail_type", "usps_first_class");
  form.append("use_type", env.LOB_USE_TYPE);
  form.append("front", new Blob([input.front], { type: "image/png" }), "front.png");

  if (env.LOB_BACK_TEMPLATE_ID) {
    form.append("back", env.LOB_BACK_TEMPLATE_ID);
    for (const [key, value] of Object.entries(mergeVariables(input.back))) {
      form.append(`merge_variables[${key}]`, value);
    }
  } else {
    form.append("back", await renderBack(input.back));
  }

  form.append("metadata[postcard_id]", input.id);

  const body = await post<LobPostcardBody>("/postcards", form, input.id);

  return {
    id: body.id,
    url: body.url ?? null,
    expectedDeliveryDate: body.expected_delivery_date ?? null,
    mode: lobMode,
  };
}

/**
 * A card to Lob's own test address, to prove the key, the file and the back
 * all pass — the check v1 never had, and the reason a broken upload was
 * first noticed by a customer. With a `test_` key nothing is printed; with a
 * `live_` key this costs one postcard, and the admin says so before the
 * button is pressed.
 */
export async function sendTestPostcard(back: PostcardBack): Promise<LobPostcard> {
  const { width, height } = PRINT_SIZES.landscape;
  const sample = await sharp({
    create: { width, height, channels: 3, background: "#ffff37" },
  })
    .png()
    .withMetadata({ density: PRINT_DPI })
    .toBuffer();

  return sendPostcard({
    id: `test-${Date.now()}`,
    to: {
      name: "Lob Test Address",
      line1: "185 Berry St",
      line2: "Suite 6100",
      city: "San Francisco",
      state: "CA",
      postalCode: "94107",
    },
    front: sample,
    back,
    description: "Postcard Gifts admin test",
  });
}

/* ------------------------------------------------------------ verification */

/*
 * Address verification, before the money.
 *
 * This is the one place outside the fulfilment sweep that talks to Lob, and
 * it is a read: `POST /v1/us_verifications` answers in a second with what
 * USPS makes of an address, so a typo in a ZIP is caught while the buyer is
 * looking at the field rather than by the sweep after payment. It is called
 * from a request handler behind its own rate limit (`verifyRateLimit`), and
 * cached here, because Lob bills verifications past the plan's allowance
 * and a buyer re-adding the same friend should not pay twice.
 *
 * Lob being down is not a refusal. Anything that is not an answer — no key,
 * an outage, a rate limit — comes back as `unknown`, and the buyer proceeds
 * as if nothing had been checked. Verification must never be what stops a
 * sale.
 */

const VERIFY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const VERIFY_CACHE_MAX = 5000;
const verifyCache = new Map<string, { at: number; value: Verification }>();

/** Tests share a process; each starts clean. */
export function resetVerificationCache(): void {
  verifyCache.clear();
}

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function cacheKey(recipient: Recipient): string {
  return [recipient.line1, recipient.line2 ?? "", recipient.city, recipient.state, recipient.postalCode.slice(0, 5)].map(squash).join("|");
}

interface UsVerificationBody {
  deliverability?: string;
  primary_line?: string;
  secondary_line?: string;
  components?: { city?: string; state?: string; zip_code?: string; zip_code_plus_4?: string };
}

/**
 * USPS answers in capitals — "185 BERRY ST" — and a postcard is addressed
 * by a person, so the suggestion is offered in title case. Directionals and
 * the state stay as they are.
 */
const KEEP_UPPER = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "PO", "APT", "STE"]);
function titleCase(value: string): string {
  return value
    .split(" ")
    .map((word) => {
      if (word === "") return word;
      if (KEEP_UPPER.has(word.toUpperCase()) && word.toUpperCase() === word) return word;
      if (/^\d/.test(word)) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function sameAddress(a: Recipient, b: Recipient): boolean {
  return (
    squash(a.line1) === squash(b.line1) &&
    squash(a.line2 ?? "") === squash(b.line2 ?? "") &&
    squash(a.city) === squash(b.city) &&
    squash(a.state) === squash(b.state) &&
    a.postalCode.slice(0, 5) === b.postalCode.slice(0, 5)
  );
}

function toDeliverability(raw: string | undefined): Deliverability {
  switch (raw) {
    case "deliverable":
    case "deliverable_unnecessary_unit":
    case "deliverable_incorrect_unit":
    case "deliverable_missing_unit":
      return raw;
    default:
      if (raw?.startsWith("undeliverable")) return "undeliverable";
      if (raw?.startsWith("deliverable")) return "deliverable";
      return "unknown";
  }
}

/** Lob's answer, read into what the form needs: a verdict, and the address in USPS's form when there is one. */
export function interpretVerification(sent: Recipient, body: UsVerificationBody): Verification {
  const deliverability = toDeliverability(body.deliverability);
  if (deliverability === "undeliverable" || deliverability === "unknown") {
    return { deliverability, suggested: null, changed: false };
  }

  const components = body.components ?? {};
  const zip = components.zip_code
    ? components.zip_code_plus_4
      ? `${components.zip_code}-${components.zip_code_plus_4}`
      : components.zip_code
    : sent.postalCode;

  const parsed = recipientSchema.safeParse({
    name: sent.name,
    line1: body.primary_line ? titleCase(body.primary_line) : sent.line1,
    line2: body.secondary_line ? titleCase(body.secondary_line) : null,
    city: components.city ? titleCase(components.city) : sent.city,
    state: components.state ?? sent.state,
    postalCode: zip,
  });
  const suggested = parsed.success ? parsed.data : sent;
  const changed = !sameAddress(sent, suggested);

  // Nothing but case or ZIP+4 differs: keep the buyer's own spelling.
  return { deliverability, suggested: changed ? suggested : sent, changed };
}

export async function verifyRecipient(recipient: Recipient): Promise<Verification> {
  if (!hasLob) return unknownVerification;

  const key = cacheKey(recipient);
  const hit = verifyCache.get(key);
  if (hit && Date.now() - hit.at < VERIFY_CACHE_TTL_MS) return hit.value;

  let body: UsVerificationBody;
  try {
    body = await postJson<UsVerificationBody>("/us_verifications", {
      primary_line: recipient.line1,
      secondary_line: recipient.line2 ?? "",
      city: recipient.city,
      state: recipient.state,
      zip_code: recipient.postalCode,
    });
  } catch (error) {
    // An outage, a rate limit, or a refusal of the *request* — none is the
    // buyer's address being wrong, so none blocks them. A 4xx is logged: it
    // would be this code sending Lob something it did not expect.
    if (error instanceof LobError && error.status >= 400 && error.status < 500 && error.status !== 429) {
      console.warn(`[lob] verification refused: ${error.message}`);
    }
    return unknownVerification;
  }

  const value = interpretVerification(recipient, body);
  if (verifyCache.size >= VERIFY_CACHE_MAX) {
    const oldest = verifyCache.keys().next().value;
    if (oldest !== undefined) verifyCache.delete(oldest);
  }
  verifyCache.set(key, { at: Date.now(), value });
  return value;
}
