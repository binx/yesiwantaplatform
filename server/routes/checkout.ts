import { randomUUID } from "node:crypto";
import { Router } from "express";
import { checkoutRequestSchema } from "../../shared/orders.js";
import { countPostcards, type CartLine } from "../../shared/cart.js";
import { todayIso } from "../../shared/postcards.js";
import { getSettings } from "../../db/repository.js";
import { findDesignsByIds } from "../../db/designs-repository.js";
import { createPendingOrder, findOrderByCheckoutSession } from "../../db/orders-repository.js";
import { env } from "../env.js";
import { httpError, writeRateLimit } from "../middleware.js";
import { getStripe } from "../stripe.js";
import { findCustomerById } from "../auth.js";
import { toCustomerOrder } from "./account.js";

/**
 * Checkout.
 *
 * The client sends design ids, mail dates and recipients — never a price.
 * The price of a postcard is read from settings here and multiplied by the
 * number of cards, so a tampered cart cannot change what anything costs.
 *
 * Stripe is given an inline `price_data` rather than a catalogue Price: there
 * is exactly one thing for sale and its price is a setting, so there is
 * nothing to publish and nothing to keep in step.
 */
export const checkoutRouter: Router = Router();

/** How far out a card may be scheduled. Lob keeps nothing this long; we do. */
const MAX_DAYS_AHEAD = 365;

/**
 * Everything about a cart that has to be true before it becomes an order,
 * whoever is placing it. Shared with the admin's complimentary route so the
 * two cannot drift: a design that was cleaned up, or a date in the past, is
 * refused with the same sentence either way.
 */
export async function assertOrderable(lines: CartLine[]): Promise<void> {
  const designIds = [...new Set(lines.flatMap((line) => line.designs.map((d) => d.designId)))];
  const designs = await findDesignsByIds(designIds);
  const known = new Map(designs.map((d) => [d.id, d]));

  for (const id of designIds) {
    const design = known.get(id);
    if (!design) throw httpError(409, "A design in your cart is no longer available. Remove it and try again.");
    if (design.orderId) throw httpError(409, "A design in your cart has already been ordered.");
    if (!design.printPath) throw httpError(409, "A design in your cart can no longer be printed. Remove it and try again.");
  }

  // Dates: not in the past, not absurdly far out. Today is fine — the sweep
  // runs every fifteen minutes and picks it up after payment.
  const today = todayIso();
  const horizon = new Date(Date.now() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const line of lines) {
    for (const design of line.designs) {
      if (design.mailDate < today) throw httpError(400, "A postcard is scheduled for a day that has passed. Pick a new date.");
      if (design.mailDate > horizon) throw httpError(400, "Postcards can be scheduled up to a year ahead.");
    }
  }
}

checkoutRouter.post("/checkout", writeRateLimit, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    throw httpError(503, "This store cannot take payments yet: Stripe is not configured.");
  }

  const parsed = checkoutRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw httpError(400, first ? `That cart could not be read: ${first.path.join(".")} ${first.message}` : "That cart could not be read.");
  }

  const settings = await getSettings();
  if (!settings) throw httpError(503, "This store has not been set up yet.");

  const lines = parsed.data.lines;
  const currency = settings.currency.toLowerCase();

  // Every design has to exist, unordered, right now, and every date has to
  // be one Lob can still act on.
  await assertOrderable(lines);

  const quantity = countPostcards(lines);
  const unitPriceCents = settings.postcardPriceCents;

  // Minted up front so it can travel in the session's metadata; the webhook
  // uses it to find this order without having to reconstruct the cart.
  const orderId = randomUUID();

  const customer = req.session.customerId ? await findCustomerById(req.session.customerId) : null;

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          quantity,
          price_data: {
            currency,
            unit_amount: unitPriceCents,
            product_data: {
              name: quantity === 1 ? "Postcard" : "Postcards",
              description: `${quantity} custom postcard${quantity === 1 ? "" : "s"}, printed and mailed on the dates you chose.`,
            },
          },
        },
      ],
      ...(customer ? { customer_email: customer.email } : {}),
      // Stripe hosts the whole promotion-code flow; codes are created in the
      // Stripe dashboard and this only records what came off.
      allow_promotion_codes: true,
      // No shipping address: the recipients *are* the addresses, and the
      // buyer's own is not needed for anything.
      success_url: `${env.PUBLIC_URL}/confirm?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.PUBLIC_URL}/cart`,
      metadata: { postcards_order_id: orderId },
      payment_intent_data: { metadata: { postcards_order_id: orderId } },
    },
    // Retries of this request reuse the same session rather than making a new
    // one; the order id is unique per attempt.
    { idempotencyKey: orderId },
  );

  if (!session.url) throw httpError(502, "Stripe did not return a checkout URL.");

  await createPendingOrder({
    id: orderId,
    checkoutSessionId: session.id,
    email: session.customer_details?.email ?? customer?.email ?? "",
    currency: settings.currency,
    unitPriceCents,
    lines,
    customerId: customer?.id ?? null,
  });

  res.json({ url: session.url, orderId });
});

/**
 * Order lookup for the confirmation page.
 *
 * Keyed by the Stripe session id from the redirect, which is unguessable, and
 * returns only what a buyer should see. The redirect is *not* treated as proof
 * of payment — the webhook is the authority — so an order still showing
 * "pending" here simply means the webhook has not landed yet.
 */
checkoutRouter.get("/checkout/:sessionId", async (req, res) => {
  const order = await findOrderByCheckoutSession(req.params.sessionId);
  if (!order) throw httpError(404, "No order found for that checkout.");

  res.json(toCustomerOrder(order));
});
