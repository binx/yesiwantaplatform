import { readFile } from "node:fs/promises";
import path from "node:path";
import Handlebars from "handlebars";
import nodemailer, { type Transporter } from "nodemailer";
import { formatMoney } from "../shared/money.js";
import type { Order } from "../shared/orders.js";
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
function toLocals(order: Order, storeName: string, colorAccent: string) {
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
      tax: formatMoney(order.taxCents, currency),
      total: formatMoney(order.totalCents, currency),
      shipping: order.shipping,
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
    },
  };
}

export async function sendOrderEmail(template: EmailTemplate, order: Order): Promise<boolean> {
  if (!order.email) return false;

  const settings = await getSettings();
  const locals = toLocals(
    order,
    settings?.name ?? "Beluga",
    settings?.theme.colorAccent ?? "#e07a5f",
  );

  let subject: string;
  let html: string;

  try {
    await registerPartials();

    const [subjectTemplate, bodyTemplate, layoutTemplate] = await Promise.all([
      compile(path.join(TEMPLATE_ROOT, template, "subject.hbs")),
      compile(path.join(TEMPLATE_ROOT, template, "body.hbs")),
      compile(path.join(TEMPLATE_ROOT, "layout.hbs")),
    ]);

    subject = subjectTemplate(locals).trim();
    html = layoutTemplate({ ...locals, subject, body: bodyTemplate(locals) });
  } catch (error) {
    console.error(`Could not render the "${template}" email:`, error);
    return false;
  }

  const mailer = getTransporter();
  if (!mailer) {
    console.log(
      `[email] SMTP is not configured; would have sent "${subject}" to ${order.email}.`,
    );
    return false;
  }

  try {
    await mailer.sendMail({ from: env.EMAIL_FROM, to: order.email, subject, html });
    return true;
  } catch (error) {
    // A failed email must never fail the webhook: the payment already
    // succeeded, and Stripe would retry the whole delivery.
    console.error(`Could not send the "${template}" email to ${order.email}:`, error);
    return false;
  }
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
