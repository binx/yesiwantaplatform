import { readFile } from "node:fs/promises";
import path from "node:path";
import Handlebars from "handlebars";
import nodemailer, { type Transporter } from "nodemailer";
import { formatMoney } from "../shared/money.js";
import { getSettings } from "../db/repository.js";
import { env } from "./env.js";

/**
 * Transactional email.
 *
 * Any SMTP provider works, and when none is configured sending is a logged
 * no-op rather than a crash. Every send path here swallows a failure on
 * purpose — the webhook that triggered it must not be retried by Stripe
 * because a mail server hiccuped — except the one behind the admin's
 * "send a test email" button, whose whole point is to surface the error.
 */

const TEMPLATE_ROOT = path.resolve("emails");

let transporter: Transporter | null = null;
let helpersRegistered = false;

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

function registerHelpers(): void {
  if (helpersRegistered) return;
  Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  helpersRegistered = true;
}

/** "14 September 2026", in the platform's language. */
export function formatDay(isoDate: string, locale: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Render a template directory (`subject.hbs` + `body.hbs`) into the shared layout. */
async function render(template: string, locals: Record<string, unknown>): Promise<{ subject: string; html: string } | null> {
  try {
    registerHelpers();

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
    console.error(`Could not send "${subject}" to ${to}:`, error);
    return false;
  }
}

async function storeLocals() {
  const settings = await getSettings();
  return {
    name: settings?.name ?? "Yes I Want A Postcard",
    colorAccent: settings?.theme.colorAccent ?? "#f5c542",
    locale: settings?.locale ?? "en-US",
    currency: settings?.currency ?? "USD",
  };
}

function url(pathname: string): string {
  return new URL(pathname, env.PUBLIC_URL).toString();
}

async function sendTemplate(template: string, to: string, locals: Record<string, unknown>): Promise<boolean> {
  if (!to) return false;
  const store = await storeLocals();
  const rendered = await render(template, { store: { name: store.name, colorAccent: store.colorAccent }, ...locals });
  if (!rendered) return false;
  return deliver(to, rendered.subject, rendered.html);
}

/* ------------------------------------------------------------ subscribers */

/** "You're subscribed to Rachel": the first thing a new subscriber hears. */
export async function sendSubscriptionStartedEmail(
  to: string,
  locals: { artistName: string; artistSlug: string; priceCents: number; currency: string; sendDay: number },
): Promise<boolean> {
  const store = await storeLocals();
  return sendTemplate("SubscriptionStarted", to, {
    artistName: locals.artistName,
    artistUrl: url(`/a/${locals.artistSlug}`),
    price: formatMoney(locals.priceCents, locals.currency, store.locale),
    sendDay: locals.sendDay,
    accountUrl: url("/account"),
  });
}

/** "Your postcard from Rachel went to print today." One per card, on the day. */
export async function sendPostcardSentEmail(
  to: string,
  locals: { artistName: string; artistSlug: string; recipientName: string; expectedDeliveryDate: string | null },
): Promise<boolean> {
  const store = await storeLocals();
  return sendTemplate("PostcardSent", to, {
    artistName: locals.artistName,
    artistUrl: url(`/a/${locals.artistSlug}`),
    recipientName: locals.recipientName,
    expectedDelivery: locals.expectedDeliveryDate ? formatDay(locals.expectedDeliveryDate, store.locale) : null,
    postcardsUrl: url("/account/postcards"),
  });
}

/* ---------------------------------------------------------------- artists */

/** "Someone new subscribed": to the artist, on each new subscription. */
export async function sendNewSubscriberEmail(to: string, locals: { artistName: string; subscriberName: string; subscriberCity: string; subscriberCount: number }): Promise<boolean> {
  return sendTemplate("NewSubscriber", to, { ...locals, studioUrl: url("/studio/subscribers") });
}

/** "Your September card went out to 41 people": to the artist, when a mailing goes. */
export async function sendMailingSentEmail(to: string, locals: { artistName: string; subscriberCount: number; mailDate: string; title: string | null }): Promise<boolean> {
  const store = await storeLocals();
  return sendTemplate("MailingSent", to, {
    ...locals,
    day: formatDay(locals.mailDate, store.locale),
    queueUrl: url("/studio/queue"),
  });
}

/* ---------------------------------------------------------------- account */

export type AccountEmailTemplate = "VerifyEmail" | "ResetPassword";

/**
 * An account email: verification or a password reset. Without SMTP the link
 * itself is logged, so a self-hosted platform can still recover an account
 * by reading the API's log.
 */
export async function sendAccountEmail(template: AccountEmailTemplate, to: string, actionUrl: string): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.log(`[email] SMTP is not configured; the ${template} link for ${to} is ${actionUrl}`);
    return false;
  }
  return sendTemplate(template, to, template === "VerifyEmail" ? { verifyUrl: actionUrl } : { resetUrl: actionUrl });
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
 * Send one message and report what the transport actually said. For the
 * "send a test email" button and nothing else.
 */
export async function sendEmailReportingFailure(to: string, subject: string, html: string): Promise<{ ok: boolean; message: string }> {
  const mailer = getTransporter();
  if (!mailer) {
    return { ok: false, message: "SMTP is not configured. Set SMTP_URL and EMAIL_FROM, then restart the API." };
  }

  try {
    await mailer.sendMail({ from: env.EMAIL_FROM, to, subject, html });
    return { ok: true, message: `Sent to ${to}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
