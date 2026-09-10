import { Router, raw } from "express";
import type Stripe from "stripe";
import {
  cancelOrder,
  claimOrdersForCustomer,
  findOrderByCheckoutSession,
  forgetWebhookEvent,
  getOrder,
  getOrderCustomerId,
  markOrderPaid,
  recordRefund,
  recordWebhookEvent,
} from "../../db/orders-repository.js";
import { attachDesignsToOrder } from "../../db/designs-repository.js";
import { findVerifiedCustomerByEmail, saveRecipientsFromOrder } from "../../db/customers-repository.js";
import { env } from "../env.js";
import { getStripe } from "../stripe.js";
import { sendOrderEmail } from "../email.js";
import { markCheckoutRecovered, notifyCheckoutExpired } from "../cart-recovery.js";
import { kickSweep } from "../fulfilment.js";

/**
 * Stripe webhooks — the authority on whether an order was paid.
 *
 * The success redirect is not proof of payment. Orders are only ever marked
 * paid here, after the signature has been verified. Mounted before the JSON
 * body parser because signature verification needs the exact raw bytes.
 */
export const webhookRouter: Router = Router();

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.metadata?.postcards_order_id;
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
    discountCents: session.total_details?.amount_discount ?? 0,
    totalCents: session.amount_total ?? order.totalCents,
    currency: (session.currency ?? order.currency).toUpperCase(),
  });

  // The designs are spoken for: the cleanup sweep leaves them alone from here.
  await attachDesignsToOrder(
    order.postcards.map((p) => p.designId),
    order.id,
  );

  // A guest checkout under an email that already belongs to a *verified*
  // customer gets linked — the same gate as registration-time claiming.
  if (!(await getOrderCustomerId(order.id))) {
    const email = session.customer_details?.email ?? order.email;
    const owner = email ? await findVerifiedCustomerByEmail(email) : null;
    if (owner) await claimOrdersForCustomer(owner.id, owner.email);
  }

  const paid = await getOrder(order.id);
  if (!paid) return;

  await sendOrderEmail("Ordered", paid);

  const customerId = await getOrderCustomerId(order.id);
  if (customerId) {
    // The people this customer just wrote to become their saved recipients,
    // so the next batch starts from a list rather than a blank form.
    await saveRecipientsFromOrder(
      customerId,
      paid.postcards.map((p) => p.recipient),
    ).catch((error: unknown) => console.error("Could not save recipients:", error));

    // A buyer who completed checkout did not abandon it.
    await markCheckoutRecovered(customerId);
  }

  // Cards dated today should not wait for the next tick. Not awaited: Lob is
  // slow, and a slow answer here trips Stripe's own retry.
  kickSweep();
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
  const order = await findOrderByCheckoutSession(session.id);
  // Nothing was charged, so this is just tidying up.
  if (order && order.status === "pending") {
    await cancelOrder(order.id);

    // The highest-intent abandonment signal there is: this buyer reached
    // Stripe's payment page. Salvaged here rather than waiting for the sweep.
    const customerId = await getOrderCustomerId(order.id);
    if (customerId) await notifyCheckoutExpired(customerId, order);
  }
}

async function handleRefund(charge: Stripe.Charge): Promise<void> {
  const orderId = charge.metadata?.postcards_order_id;
  if (!orderId) return;

  const order = await getOrder(orderId);
  if (!order) return;

  // `amount_refunded` is the running total on the charge, not the delta for
  // this event, so record the difference against what we already knew.
  const delta = charge.amount_refunded - order.refundedCents;
  await recordRefund(order.id, delta);

  /*
   * A full refund withdraws whatever has not gone to print. A partial one
   * leaves the schedule alone: it says nothing about which card came back,
   * and a merchant refunding one damaged card of ten still wants the other
   * nine mailed.
   */
  if (charge.amount_refunded >= charge.amount) {
    await cancelOrder(order.id, "refunded");
  }
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
      event = stripe.webhooks.constructEvent(req.body as Buffer, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (error) {
      console.warn("Rejected a webhook with an invalid signature:", (error as Error).message);
      res.status(400).json({ error: "Invalid signature." });
      return;
    }

    // Stripe delivers at least once. Without this, a retry would send a
    // duplicate confirmation email.
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
      // retry would be dismissed as a duplicate.
      await forgetWebhookEvent(event.id);

      console.error(`Failed handling ${event.type} (${event.id}):`, error);
      res.status(500).json({ error: "Handler failed." });
      return;
    }

    res.json({ received: true });
  },
);
