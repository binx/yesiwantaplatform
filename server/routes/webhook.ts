import { Router, raw } from "express";
import type Stripe from "stripe";
import {
  decrementInventoryForOrder,
  findOrderByCheckoutSession,
  forgetWebhookEvent,
  getOrder,
  markOrderPaid,
  recordRefund,
  recordWebhookEvent,
  restockInventoryForOrder,
  updateFulfilment,
} from "../../db/orders-repository.js";
import { env } from "../env.js";
import { getStripe } from "../stripe.js";
import { sendOrderEmail } from "../email.js";

/**
 * Stripe webhooks — the authority on whether an order was paid.
 *
 * The success redirect is not proof of payment: a buyer can close the tab, and
 * the URL can be visited directly. Orders are only ever marked paid here,
 * after the signature has been verified.
 *
 * Mounted before the JSON body parser because signature verification needs the
 * exact raw bytes Stripe signed.
 */
export const webhookRouter: Router = Router();

/** Stripe moved shipping onto `collected_information`; accept either shape. */
function readShipping(session: Stripe.Checkout.Session) {
  const withCollected = session as Stripe.Checkout.Session & {
    collected_information?: { shipping_details?: Stripe.Checkout.Session.CollectedInformation.ShippingDetails | null };
    shipping_details?: { name?: string | null; address?: Stripe.Address | null } | null;
  };

  const details =
    withCollected.collected_information?.shipping_details ?? withCollected.shipping_details ?? null;

  const address = details?.address ?? null;

  return {
    name: details?.name ?? session.customer_details?.name ?? null,
    line1: address?.line1 ?? null,
    line2: address?.line2 ?? null,
    city: address?.city ?? null,
    state: address?.state ?? null,
    postalCode: address?.postal_code ?? null,
    country: address?.country ?? null,
  };
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.metadata?.beluga_order_id;
  const order = orderId ? await getOrder(orderId) : await findOrderByCheckoutSession(session.id);

  if (!order) {
    console.error(`Webhook for unknown order (session ${session.id}).`);
    return;
  }

  // Already processed — a replay, or a second event for the same session.
  if (order.status !== "pending") return;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  await markOrderPaid(order.id, {
    paymentIntentId,
    email: session.customer_details?.email ?? order.email,
    subtotalCents: session.amount_subtotal ?? order.subtotalCents,
    shippingCents: session.total_details?.amount_shipping ?? 0,
    taxCents: session.total_details?.amount_tax ?? 0,
    discountCents: session.total_details?.amount_discount ?? 0,
    totalCents: session.amount_total ?? order.totalCents,
    currency: (session.currency ?? order.currency).toUpperCase(),
    shipping: readShipping(session),
  });

  // Stock comes down only once payment is confirmed.
  const shortfalls = await decrementInventoryForOrder(order.id);
  if (shortfalls.length > 0) {
    console.warn(
      `Order ${order.reference} was paid but these items were out of stock: ${shortfalls.join(", ")}. Flagged for review.`,
    );
  }

  const paid = await getOrder(order.id);
  if (paid) await sendOrderEmail("Ordered", paid);
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
  const order = await findOrderByCheckoutSession(session.id);
  // Nothing was charged and no stock was taken, so this is just tidying up.
  if (order && order.status === "pending") {
    await updateFulfilment(order.id, {
      status: "cancelled",
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
    });
  }
}

async function handleRefund(charge: Stripe.Charge): Promise<void> {
  const orderId = charge.metadata?.beluga_order_id;
  if (!orderId) return;

  const order = await getOrder(orderId);
  if (!order) return;

  /**
   * `amount_refunded` is the running total on the charge, not the delta for
   * this event, so record the difference against what we already knew. A
   * replayed event finds the difference is zero and changes nothing — which is
   * what keeps a Stripe retry from doubling the figure.
   */
  await recordRefund(order.id, charge.amount_refunded - order.refundedCents);

  // A partial refund leaves fulfilment alone: a buyer refunded for one damaged
  // item of three still has two shipping. It also tells us nothing about which
  // line came back, so there is nothing to restock.
  if (charge.amount_refunded < charge.amount) return;

  // Before this, every refund permanently burned the stock the order consumed.
  // Silently, too: the decrement is guarded against going negative, so the
  // count simply drifted until the store showed sold out on things it had.
  await restockInventoryForOrder(order.id);

  await updateFulfilment(order.id, {
    status: "refunded",
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
  });
}

webhookRouter.post(
  "/webhooks/stripe",
  raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    const stripe = getStripe();
    const signature = req.get("stripe-signature");

    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
      res.status(503).json({ error: "Webhooks are not configured." });
      return;
    }
    if (!signature) {
      res.status(400).json({ error: "Missing Stripe signature." });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      // An invalid signature means this did not come from Stripe.
      console.warn("Rejected a webhook with an invalid signature:", (error as Error).message);
      res.status(400).json({ error: "Invalid signature." });
      return;
    }

    // Stripe delivers at least once. Without this, a retry would decrement
    // stock a second time and send a duplicate confirmation email.
    const isNew = await recordWebhookEvent(event.id, event.type);
    if (!isNew) {
      res.json({ received: true, duplicate: true });
      return;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutCompleted(event.data.object);
          break;
        case "checkout.session.expired":
          await handleCheckoutExpired(event.data.object);
          break;
        case "charge.refunded":
          await handleRefund(event.data.object);
          break;
        default:
          // Unhandled types are acknowledged so Stripe stops retrying them.
          break;
      }
    } catch (error) {
      // Release the dedup record before answering 500, otherwise Stripe's
      // retry would be dismissed as a duplicate and the order would never be
      // processed at all.
      await forgetWebhookEvent(event.id);

      console.error(`Failed handling ${event.type} (${event.id}):`, error);
      res.status(500).json({ error: "Handler failed." });
      return;
    }

    res.json({ received: true });
  },
);
