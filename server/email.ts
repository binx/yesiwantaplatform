import { readFile } from "node:fs/promises";
import path from "node:path";
import Handlebars from "handlebars";
import nodemailer, { type Transporter } from "nodemailer";
import { formatMoney } from "../shared/money.js";
import type { Order } from "../shared/orders.js";
import { formatRecipient, type Postcard } from "../shared/postcards.js";
import { getSettings } from "../db/repository.js";
import { env } from "./env.js";

/**
 * Transactional email.
 *
 * v1 hard-coded a Gmail OAuth2 transport and pulled six EMAIL_* variables from
 * the environment; if any were missing, sending failed at runtime with a
 * console error and the customer heard nothing. Here any SMTP provider works,
 * and when none is configured sending is a logged no-op rather than a crash.
 */

export type EmailTemplate = "Ordered" | "Refunded";

const TEMPLATE_ROOT = path.resolve("emails");

let transporter: Transporter | null = null;
let partialsRegistered = false;

export function isEmailConfigured(): boolean {
  return Boolean(env.SMTP_URL && env.EMAIL_FROM);
}

function getTransporter(): Transporter | null {
  if (!isEmailConfigured()) return null;
  transporter ??= nodemailer.createTransport(env.SMTP_URL);
  return transporter;
}

async function compile(file: string): Promise<Handlebars.TemplateDelegate> {
  return Handlebars.compile(await readFile(file, "utf8"));
}

async function registerPartials(): Promise<void> {
  if (partialsRegistered) return;
  Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  Handlebars.registerPartial(
    "postcards",
    await readFile(path.join(TEMPLATE_ROOT, "postcards.hbs"), "utf8"),
  );
  partialsRegistered = true;
}

/** "14 September 2026", in the store's language. */
function formatDay(isoDate: string, locale: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** A card's address as the buyer may read it: a reply's is the sender's, and stays private. */
function addressLine(postcard: Postcard): string {
  return postcard.isReply ? "address kept private" : formatRecipient(postcard.recipient);
}

/** Where a buyer follows the order: the confirmation page, keyed by the session. */
export function trackingUrlFor(order: Order): string {
  return new URL(`/confirm?session_id=${order.checkoutSessionId}`, env.PUBLIC_URL).toString();
}

/**
 * Shape the order into display-ready strings; templates do no arithmetic.
 *
 * The cart lines are rebuilt from `batchIndex`, so the email reads the way
 * the cart did — "2 designs to 5 people" — rather than as a flat list of
 * ten cards. Recipients are capped per batch: a bulk upload of 300 friends
 * should not produce a 300-line email.
 */
function toLocals(order: Order, storeName: string, colorAccent: string, locale: string) {
  const currency = order.currency;
  const RECIPIENT_CAP = 12;

  const batches = new Map<number, Postcard[]>();
  for (const postcard of order.postcards) {
    const list = batches.get(postcard.batchIndex);
    if (list) list.push(postcard);
    else batches.set(postcard.batchIndex, [postcard]);
  }

  const lines = [...batches.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, postcards]) => {
      const designs = new Set(postcards.map((p) => p.designId));
      const recipients = [...new Map(postcards.map((p) => [formatRecipient(p.recipient) + p.recipient.name, p])).values()];
      const dates = [...new Set(postcards.map((p) => p.mailDate))].sort();

      return {
        designCount: designs.size,
        designLabel: designs.size === 1 ? "postcard design" : "postcard designs",
        recipientCount: recipients.length,
        recipientLabel: recipients.length === 1 ? "recipient" : "recipients",
        recipients: recipients.slice(0, RECIPIENT_CAP).map((p) => ({ name: p.recipient.name, address: addressLine(p) })),
        moreRecipients: Math.max(recipients.length - RECIPIENT_CAP, 0),
        firstDate: formatDay(dates[0]!, locale),
        lastDate: formatDay(dates[dates.length - 1]!, locale),
        spansDates: dates.length > 1,
        count: postcards.length,
      };
    });

  return {
    store: { name: storeName, colorAccent },
    order: {
      reference: order.reference,
      email: order.email,
      date: new Date(order.createdAt).toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      postcardCount: order.postcardCount,
      postcardLabel: order.postcardCount === 1 ? "postcard" : "postcards",
      unitPrice: formatMoney(order.unitPriceCents, currency, locale),
      subtotal: formatMoney(order.subtotalCents, currency, locale),
      hasDiscount: order.discountCents > 0,
      discount: `−${formatMoney(order.discountCents, currency, locale)}`,
      total: formatMoney(order.totalCents, currency, locale),
      refunded: formatMoney(order.refundedCents, currency, locale),
      lines,
      trackingUrl: trackingUrlFor(order),
    },
  };
}

/** Render a template directory (`subject.hbs` + `body.hbs`) into the shared layout. */
async function render(
  template: string,
  locals: Record<string, unknown>,
): Promise<{ subject: string; html: string } | null> {
  try {
    await registerPartials();

    const [subjectTemplate, bodyTemplate, layoutTemplate] = await Promise.all([
      compile(path.join(TEMPLATE_ROOT, template, "subject.hbs")),
      compile(path.join(TEMPLATE_ROOT, template, "body.hbs")),
      compile(path.join(TEMPLATE_ROOT, "layout.hbs")),
    ]);

    const subject = subjectTemplate(locals).trim();
    const html = layoutTemplate({ ...locals, subject, body: bodyTemplate(locals) });
    return { subject, html };
  } catch (error) {
    console.error(`Could not render the "${template}" email:`, error);
    return null;
  }
}

/** Send already-rendered HTML, logging rather than sending when SMTP is off. */
async function deliver(to: string, subject: string, html: string): Promise<boolean> {
  const mailer = getTransporter();
  if (!mailer) {
    console.log(`[email] SMTP is not configured; would have sent "${subject}" to ${to}.`);
    return false;
  }

  try {
    await mailer.sendMail({ from: env.EMAIL_FROM, to, subject, html });
    return true;
  } catch (error) {
    // A failed email must never fail the caller: the payment already
    // succeeded, and Stripe would retry the whole webhook delivery.
    console.error(`Could not send "${subject}" to ${to}:`, error);
    return false;
  }
}

async function storeLocals() {
  const settings = await getSettings();
  return {
    name: settings?.name ?? "Postcard Gifts",
    colorAccent: settings?.theme.colorAccent ?? "#ffff37",
    locale: settings?.locale ?? "en-US",
  };
}

export async function sendOrderEmail(template: EmailTemplate, order: Order): Promise<boolean> {
  if (!order.email) return false;

  const store = await storeLocals();
  const rendered = await render(template, toLocals(order, store.name, store.colorAccent, store.locale));
  if (!rendered) return false;

  return deliver(order.email, rendered.subject, rendered.html);
}

/**
 * "Your postcard to Grandma went to print today."
 *
 * One email per card, on the day it goes to Lob. The point of the schedule
 * is that cards go out weeks apart, and a buyer who set that up in August
 * would otherwise have no idea whether October's card ever left.
 */
export async function sendPostcardSentEmail(order: Order, postcard: Postcard): Promise<boolean> {
  if (!order.email) return false;

  const store = await storeLocals();
  const rendered = await render("PostcardSent", {
    ...toLocals(order, store.name, store.colorAccent, store.locale),
    postcard: {
      recipientName: postcard.recipient.name,
      address: addressLine(postcard),
      expectedDelivery: postcard.expectedDeliveryDate
        ? formatDay(postcard.expectedDeliveryDate, store.locale)
        : null,
      proofUrl: postcard.lobUrl,
    },
  });
  if (!rendered) return false;

  return deliver(order.email, rendered.subject, rendered.html);
}

export type AccountEmailTemplate = "VerifyEmail" | "ResetPassword";

/**
 * An account email: verification or a password reset. Fails the same way as
 * the order path — logged and swallowed, never thrown — because the routes
 * that send these must respond identically whether or not the send worked.
 * Without SMTP the link itself is logged, so a self-hosted store can still
 * recover an account by reading the API's log.
 */
export async function sendAccountEmail(
  template: AccountEmailTemplate,
  to: string,
  actionUrl: string,
): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.log(`[email] SMTP is not configured; the ${template} link for ${to} is ${actionUrl}`);
    return false;
  }

  const store = await storeLocals();
  const locals = {
    store: { name: store.name, colorAccent: store.colorAccent },
    ...(template === "VerifyEmail" ? { verifyUrl: actionUrl } : { resetUrl: actionUrl }),
  };

  const rendered = await render(template, locals);
  if (!rendered) return false;

  return deliver(to, rendered.subject, rendered.html);
}

export interface CartRecoveryItem {
  summary: string;
  count: number;
  lineTotal: string;
}

/** A cart recovery reminder. */
export async function sendCartRecoveryEmail(
  to: string,
  locals: {
    items: CartRecoveryItem[];
    subtotal: string;
    droppedCount: number;
    recoverUrl: string;
    unsubscribeUrl: string;
  },
): Promise<boolean> {
  const store = await storeLocals();
  const rendered = await render("AbandonedCart", {
    store: { name: store.name, colorAccent: store.colorAccent },
    ...locals,
  });
  if (!rendered) return false;

  return deliver(to, rendered.subject, rendered.html);
}

/**
 * "Maya sent you their address" — to the requester, who opted in per link.
 * The responder is never emailed; they were handed the link by the
 * requester in whatever channel the two of them use.
 */
export async function sendAddressReceivedEmail(
  to: string,
  locals: { name: string; address: string; bookUrl: string },
): Promise<boolean> {
  const store = await storeLocals();
  const rendered = await render("AddressReceived", {
    store: { name: store.name, colorAccent: store.colorAccent },
    ...locals,
  });
  if (!rendered) return false;

  return deliver(to, rendered.subject, rendered.html);
}

/** Test hook. */
export function resetMailer(): void {
  transporter = null;
}

/** A plain transactional email: subject and HTML already rendered, one recipient. */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  return deliver(to, subject, html);
}

/**
 * Send one message and report what the transport actually said.
 *
 * Every other path here swallows a failure on purpose. This one is for the
 * "send a test email" button and nothing else: the whole point of that button
 * is to surface the error, which means the message has to survive the call.
 */
export async function sendEmailReportingFailure(
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; message: string }> {
  const mailer = getTransporter();
  if (!mailer) {
    return {
      ok: false,
      message: "SMTP is not configured. Set SMTP_URL and EMAIL_FROM, then restart the API.",
    };
  }

  try {
    await mailer.sendMail({ from: env.EMAIL_FROM, to, subject, html });
    return { ok: true, message: `Sent to ${to}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
