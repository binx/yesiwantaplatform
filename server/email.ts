import { readFile } from "node:fs/promises";
import path from "node:path";
import Handlebars from "handlebars";
import nodemailer, { type Transporter } from "nodemailer";
import { formatMoney } from "../shared/money.js";
import type { Order } from "../shared/orders.js";
import type { TaxBehavior } from "../shared/schema.js";
import { taxLineLabel } from "../shared/tax.js";
import { getSettings } from "../db/repository.js";
import { env } from "./env.js";

/**
 * Transactional email.
 *
 * v1 hard-coded a Gmail OAuth2 transport and pulled six EMAIL_* variables from
 * the environment; if any were missing, sending failed at runtime with a
 * console error and the customer heard nothing. Here any SMTP provider works,
 * and when none is configured sending is a logged no-op rather than a crash —
 * a store should be able to take orders before its email is wired up.
 */

export type EmailTemplate = "Ordered" | "Processing" | "Shipped" | "Refunded";

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
  Handlebars.registerPartial("items", await readFile(path.join(TEMPLATE_ROOT, "items.hbs"), "utf8"));
  partialsRegistered = true;
}

/** Shape the order into display-ready strings; templates do no arithmetic. */
function toLocals(
  order: Order,
  storeName: string,
  colorAccent: string,
  taxBehavior: TaxBehavior,
) {
  const currency = order.currency;

  return {
    store: { name: storeName, colorAccent },
    order: {
      reference: order.reference,
      email: order.email,
      date: new Date(order.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        // v1's order dates were a month early: it used getMonth() without +1.
        month: "long",
        day: "numeric",
      }),
      items: order.items.map((item) => ({
        productName: item.productName,
        variantLabel: item.variantLabel,
        optionsText: Object.entries(item.options)
          .map(([key, value]) => `${key}: ${value}`)
          .join(", "),
        quantity: item.quantity,
        lineTotal: formatMoney(item.unitPriceCents * item.quantity, currency),
      })),
      subtotal: formatMoney(order.subtotalCents, currency),
      shippingCost: order.shippingCents === 0 ? "Free" : formatMoney(order.shippingCents, currency),
      hasDiscount: order.discountCents > 0,
      // Formatted as a deduction here, because templates do no arithmetic.
      discount: `\u2212${formatMoney(order.discountCents, currency)}`,
      hasTax: order.taxCents > 0,
      /*
       * "Tax" or "Includes tax", never both readings at once.
       *
       * With inclusive pricing the total already contains the tax, so a row
       * that looks like the other lines reads as a second charge. The label
       * carries the difference; the template stays arithmetic-free.
       */
      taxLabel: taxLineLabel(taxBehavior),
      tax: formatMoney(order.taxCents, currency),
      total: formatMoney(order.totalCents, currency),
      shipping: order.shipping,
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
    },
  };
}

/**
 * Render a template directory (`subject.hbs` + `body.hbs`) into the shared
 * layout. The order-shaped path and the account path below both go through
 * this; neither reimplements it.
 */
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
    // A failed email must never fail the caller: for order email the payment
    // already succeeded and Stripe would retry the whole webhook delivery;
    // for account email the account or reset itself must still go through.
    console.error(`Could not send "${subject}" to ${to}:`, error);
    return false;
  }
}

export async function sendOrderEmail(template: EmailTemplate, order: Order): Promise<boolean> {
  if (!order.email) return false;

  const settings = await getSettings();
  const locals = toLocals(
    order,
    settings?.name ?? "Beluga",
    settings?.theme.colorAccent ?? "#e07a5f",
    settings?.taxBehavior ?? "exclusive",
  );

  const rendered = await render(template, locals);
  if (!rendered) return false;

  return deliver(order.email, rendered.subject, rendered.html);
}

export type AccountEmailTemplate = "VerifyEmail" | "ResetPassword";

/**
 * A customer-account email: verification or a password reset.
 *
 * Not order-shaped, so it does not go through `toLocals` — but it renders
 * into the same layout, with the same store name and accent colour, and fails
 * the same way: logged and swallowed, never thrown. The register and
 * forgot-password routes must respond identically whether this succeeds, so a
 * throw here would be a second enumeration channel.
 */
export async function sendAccountEmail(
  template: AccountEmailTemplate,
  to: string,
  actionUrl: string,
): Promise<boolean> {
  const settings = await getSettings();
  const locals = {
    store: { name: settings?.name ?? "Beluga", colorAccent: settings?.theme.colorAccent ?? "#e07a5f" },
    ...(template === "VerifyEmail" ? { verifyUrl: actionUrl } : { resetUrl: actionUrl }),
  };

  const rendered = await render(template, locals);
  if (!rendered) return false;

  return deliver(to, rendered.subject, rendered.html);
}

/** Which template, if any, a fulfilment change should notify with. */
export function templateForStatus(status: string): EmailTemplate | null {
  switch (status) {
    case "paid":
      return "Ordered";
    case "processing":
      return "Processing";
    case "shipped":
      return "Shipped";
    case "refunded":
      return "Refunded";
    default:
      return null;
  }
}

/** Test hook. */
export function resetMailer(): void {
  transporter = null;
}

/**
 * A plain transactional email, not shaped like an order.
 *
 * `sendOrderEmail` takes an `Order` and renders the order templates, which is
 * everything the store needed until invitations. This is the general path:
 * subject and HTML already rendered, one recipient.
 *
 * Returns false when SMTP is not configured, and logs what it would have sent
 * in the same shape as the order path — the invite route uses that to hand the
 * link back to the admin instead, so a store without email is not stuck.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  return deliver(to, subject, html);
}
