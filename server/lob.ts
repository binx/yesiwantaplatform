import { readFile } from "node:fs/promises";
import path from "node:path";
import Handlebars from "handlebars";
import sharp from "sharp";
import { env, hasLob, lobMode } from "./env.js";
import { BACK_FONTS, PRINT_SIZES, stripEmoji, type PostcardBack, type Recipient } from "../shared/postcards.js";

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
 * Make the print-ready front from whatever the buyer uploaded.
 *
 * Centre-cropped to the card's aspect ratio, which is what v1's canvas did
 * — the preview on the site draws the same crop, so what the buyer sees is
 * what prints. Then rotated to landscape if it was portrait, and written as
 * PNG with the density Lob expects to find.
 */
export async function printFile(
  source: Buffer,
  orientation: "portrait" | "landscape",
): Promise<{ bytes: Buffer; width: number; height: number }> {
  const size = PRINT_SIZES[orientation];

  /*
   * Two pipelines, not one: sharp applies `rotate` before `resize` whatever
   * order they are called in, so a single chain would turn the source first
   * and then crop the wrong way round. The crop lands first, on its own;
   * the quarter turn is a second pass over the cropped bytes.
   */
  const cropped = await sharp(source, { failOn: "error" })
    .rotate() // honour EXIF orientation before cropping
    .resize(size.width, size.height, { fit: "cover", position: "centre" })
    // Onto white: a transparent PNG would otherwise print its transparency as
    // black, which is not what anyone who exported a cut-out meant.
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();

  // A quarter turn clockwise puts the top of a portrait card on the right
  // edge, which is how a landscape frame holds a portrait picture.
  const oriented = orientation === "portrait" ? sharp(cropped).rotate(90) : sharp(cropped);

  const bytes = await oriented
    .png({ compressionLevel: 6 })
    .withMetadata({ density: PRINT_DPI })
    .toBuffer();

  return { bytes, width: PRINT_SIZES.landscape.width, height: PRINT_SIZES.landscape.height };
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
  let response: Response;
  try {
    response = await fetch(`${API}${endpoint}`, {
      method: "POST",
      headers: {
        authorization: authorization(),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: form,
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
